import json
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.orm import selectinload

from ...extensions import db
from ...models import AgentRun, ContextCheckpoint, Message, MultiAgentMessage, MultiAgentNode
from .config import RECENT_FULL_TURNS
from .image_context import text_only_images
from .tool_history import bounded_tool_result_content
from .tool_results import slice_to_token_budget

HISTORY_RESULT_TOKEN_BUDGET = 1000
HISTORY_ARGUMENT_TOKEN_BUDGET = 256
HISTORY_ARCHIVE_PREFIX = "Complete AgentEvent history for completed turn "


@dataclass(frozen=True)
class ContextBlock:
    messages: list[dict]
    cursor: dict
    keep: bool = False


def _message_content(message: Message) -> str:
    attachments = message.attachments or []
    if not attachments:
        return message.content
    lines = [
        "Attached files (use the exact local paths when inspecting them):",
        *(f"- {item['name']}: {item['path']}" for item in attachments),
    ]
    return f"{message.content}\n\n" + "\n".join(lines)


CONVERSATION_EVENT_TYPES = frozenset(
    {
        "tool.requested",
        "tool.output",
        "reasoning.completed",
        "message.progress",
        "input.received",
        "task.plan.updated",
        "run.cancelled",
        "run.failed",
    }
)


def is_conversation_event(event_type: str) -> bool:
    return event_type in CONVERSATION_EVENT_TYPES


def run_history_events(run: AgentRun, after_sequence: int = 0) -> list[dict]:
    return [
        {
            "sequence": event.sequence,
            "type": event.event_type,
            "payload": text_only_images(event.payload),
        }
        for event in run.events
        if event.sequence > after_sequence and is_conversation_event(event.event_type)
    ]


def snapshot_run_events(snapshot: dict) -> tuple[UUID, list[dict]] | None:
    """Decode the durable branch archive; it is never sent verbatim to the model."""
    content = snapshot.get("content")
    if not isinstance(content, str) or not content.startswith(HISTORY_ARCHIVE_PREFIX):
        return None
    header, _, body = content.partition(":\n")
    return UUID(header.removeprefix(HISTORY_ARCHIVE_PREFIX)), json.loads(body)


def _project_history(run_id: UUID, events: list[dict]) -> dict | None:
    calls = {}
    observations = []
    for event in events:
        payload = event["payload"]
        if event["type"] == "tool.requested":
            for call in payload.get("toolCalls", []):
                function = call["function"]
                arguments = function.get("arguments") or "{}"
                try:
                    parsed = json.loads(arguments)
                except (json.JSONDecodeError, TypeError):
                    parsed = {"arguments": str(arguments)}
                if isinstance(parsed, dict) and "patch" in parsed:
                    parsed = {key: value for key, value in parsed.items() if key != "patch"}
                serialized = json.dumps(parsed, ensure_ascii=False)
                preview, end = slice_to_token_budget(serialized, 0, HISTORY_ARGUMENT_TOKEN_BUDGET)
                calls[call["id"]] = {
                    "tool": function["name"],
                    "argumentsPreview": preview,
                    "argumentsTruncated": end < len(serialized),
                }
        elif event["type"] == "tool.output":
            for item in payload.get("results", []):
                call_id = item["callId"]
                observations.append(
                    {
                        **calls.pop(call_id, {}),
                        "resultRef": {"runId": str(run_id), "callId": call_id},
                        "result": json.loads(
                            bounded_tool_result_content(run_id, item, HISTORY_RESULT_TOKEN_BUDGET)
                        ),
                    }
                )
        elif event["type"] in {
            "input.received",
            "task.plan.updated",
            "run.cancelled",
            "run.failed",
        }:
            observations.append({"type": event["type"], "payload": payload})
    if not observations:
        return None
    return {
        "role": "assistant",
        "content": f"Completed turn observations ({run_id}):\n"
        + json.dumps(observations, ensure_ascii=False, separators=(",", ":")),
    }


def project_context_snapshot(snapshot: list[dict]) -> list[dict]:
    projected = []
    for message in snapshot:
        archive = snapshot_run_events(message)
        if archive is None:
            projected.append(message)
        elif context := _project_history(*archive):
            projected.append(context)
    return projected


def _run_context_message(
    run: AgentRun, protected: bool, after_sequence: int = 0
) -> dict[str, str] | None:
    summary = run.summary
    if (
        not after_sequence
        and not protected
        and summary
        and summary.status == "completed"
        and summary.summary
    ):
        return {
            "role": "assistant",
            "content": f"AgentEvent summary for completed turn {run.id}:\n{summary.summary}",
        }
    return _project_history(run.id, run_history_events(run, after_sequence))


def _message_index(messages: list[Message], message_id: UUID | None) -> int:
    if message_id is None:
        return 0
    for index, message in enumerate(messages):
        if message.id == message_id:
            return index + 1
    return 0


def branch_context_snapshot(message: Message) -> list[dict] | None:
    if message.context_snapshot is not None:
        return message.context_snapshot
    if message.role == "assistant" and message.agent_run_id:
        run = db.session.get(AgentRun, message.agent_run_id)
        if run:
            events = run_history_events(run)
            return (
                [
                    {
                        "role": "system",
                        "content": f"{HISTORY_ARCHIVE_PREFIX}{run.id}:\n"
                        + json.dumps(events, ensure_ascii=False, separators=(",", ":")),
                    }
                ]
                if events
                else None
            )
    return None


def _protected_run_ids(messages: list[Message], runs: dict[UUID, AgentRun]) -> set[UUID]:
    completed = [
        message.agent_run_id
        for message in messages
        if message.role == "assistant" and message.agent_run_id and message.agent_run_id in runs
    ]
    return set(completed[-RECENT_FULL_TURNS:])


def history_runs(messages: list[Message]) -> dict[UUID, AgentRun]:
    """Batch-load completed runs, skipping full events when a summary can be used."""
    identifiers = {
        message.agent_run_id
        for message in messages
        if message.role == "assistant" and message.agent_run_id
    }
    if not identifiers:
        return {}
    runs = {
        run.id: run
        for run in db.session.scalars(
            db.select(AgentRun)
            .where(AgentRun.id.in_(identifiers), AgentRun.status == "completed")
            .options(selectinload(AgentRun.summary))
        )
    }
    protected = _protected_run_ids(messages, runs)
    full_history = [
        run.id
        for run in runs.values()
        if run.id in protected
        or not (run.summary and run.summary.status == "completed" and run.summary.summary)
    ]
    if full_history:
        db.session.scalars(
            db.select(AgentRun)
            .where(AgentRun.id.in_(full_history))
            .options(selectinload(AgentRun.events))
        ).all()
    return runs


def _render_messages(
    messages: list[Message],
    protected_run_ids: set[UUID],
    runs: dict[UUID, AgentRun],
    checkpoint: ContextCheckpoint | None = None,
) -> list[dict]:
    rendered: list[dict] = []
    for message in messages:
        if message.context_snapshot:
            rendered.extend(project_context_snapshot(message.context_snapshot))
        if message.role == "assistant" and message.agent_run_id:
            run = runs.get(message.agent_run_id)
            if run:
                after_sequence = (
                    checkpoint.covered_event_sequence
                    if checkpoint and checkpoint.covered_run_id == run.id
                    else 0
                )
                context = _run_context_message(run, run.id in protected_run_ids, after_sequence)
                if context:
                    rendered.append(context)
        rendered.append({"role": message.role, "content": _message_content(message)})
    return rendered


def _conversation_blocks(
    messages: list[Message], checkpoint: ContextCheckpoint | None
) -> list[ContextBlock]:
    runs = history_runs(messages)
    protected = _protected_run_ids(messages, runs)
    blocks = []
    pending = []
    for message in messages:
        if message.role == "user" and pending:
            blocks.append(
                ContextBlock(
                    _render_messages(pending, protected, runs, checkpoint),
                    {"covered_message_id": pending[-1].id},
                )
            )
            pending = []
        pending.append(message)
        if message.role == "assistant":
            blocks.append(
                ContextBlock(
                    _render_messages(pending, protected, runs, checkpoint),
                    {"covered_message_id": message.id},
                )
            )
            pending = []
    if pending:
        blocks.append(
            ContextBlock(_render_messages(pending, protected, runs, checkpoint), {}, keep=True)
        )
    return blocks


def mailbox_blocks(conversation_id: UUID, after_sequence: int = 0) -> list[ContextBlock]:
    messages = list(
        db.session.scalars(
            db.select(MultiAgentMessage)
            .join(MultiAgentNode, MultiAgentNode.task_id == MultiAgentMessage.task_id)
            .where(
                MultiAgentNode.conversation_id == conversation_id,
                MultiAgentMessage.sequence > after_sequence,
            )
            .order_by(MultiAgentMessage.sequence)
        )
    )
    return [
        ContextBlock(
            [
                {
                    "role": "system",
                    "content": (
                        "Collaboration group chat "
                        f"[{item.from_node.name if item.from_node else 'User'} "
                        f"@ {item.to_node.name if item.to_node else 'User'}]:\n{item.content}"
                    ),
                }
            ],
            {"mailboxSequence": item.sequence},
            keep=index == len(messages) - 1,
        )
        for index, item in enumerate(messages)
    ]
