import json
from dataclasses import dataclass
from uuid import UUID

from ...extensions import db
from ...models import AgentRun, ContextCheckpoint, Message, MultiAgentMessage, MultiAgentNode
from .config import RECENT_FULL_TURNS


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


def _run_context_message(run: AgentRun, protected: bool, after_sequence: int = 0) -> dict[str, str]:
    summary = run.summary
    if (
        not after_sequence
        and not protected
        and summary
        and summary.status == "completed"
        and summary.summary
    ):
        return {
            "role": "system",
            "content": f"AgentEvent summary for completed turn {run.id}:\n{summary.summary}",
        }
    events = [
        {
            "sequence": event.sequence,
            "type": event.event_type,
            "payload": event.payload,
        }
        for event in run.events
        if event.sequence > after_sequence
    ]
    return {
        "role": "system",
        "content": (
            f"Complete AgentEvent history for completed turn {run.id}:\n"
            f"{json.dumps(events, ensure_ascii=False, separators=(',', ':'))}"
        ),
    }


def _message_index(messages: list[Message], message_id: UUID | None) -> int:
    if message_id is None:
        return 0
    for index, message in enumerate(messages):
        if message.id == message_id:
            return index + 1
    return 0


def _protected_run_ids(messages: list[Message]) -> set[UUID]:
    completed = [
        message.agent_run_id
        for message in messages
        if message.role == "assistant"
        and message.agent_run_id
        and (run := db.session.get(AgentRun, message.agent_run_id))
        and run.status == "completed"
    ]
    return set(completed[-RECENT_FULL_TURNS:])


def _render_messages(
    messages: list[Message],
    protected_run_ids: set[UUID],
    checkpoint: ContextCheckpoint | None = None,
) -> list[dict]:
    rendered: list[dict] = []
    for message in messages:
        if message.role == "assistant" and message.agent_run_id:
            run = db.session.get(AgentRun, message.agent_run_id)
            if run and run.status == "completed":
                after_sequence = (
                    checkpoint.covered_event_sequence
                    if checkpoint and checkpoint.covered_run_id == run.id
                    else 0
                )
                rendered.append(
                    _run_context_message(run, run.id in protected_run_ids, after_sequence)
                )
        rendered.append({"role": message.role, "content": _message_content(message)})
    return rendered


def _conversation_blocks(
    messages: list[Message], protected: set[UUID], checkpoint: ContextCheckpoint | None
) -> list[ContextBlock]:
    blocks = []
    pending = []
    for message in messages:
        if message.role == "user" and pending:
            blocks.append(
                ContextBlock(
                    _render_messages(pending, protected, checkpoint),
                    {"covered_message_id": pending[-1].id},
                )
            )
            pending = []
        pending.append(message)
        if message.role == "assistant":
            blocks.append(
                ContextBlock(
                    _render_messages(pending, protected, checkpoint),
                    {"covered_message_id": message.id},
                )
            )
            pending = []
    if pending:
        blocks.append(ContextBlock(_render_messages(pending, protected, checkpoint), {}, keep=True))
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
