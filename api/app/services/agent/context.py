import json
import math
from collections.abc import Generator
from dataclasses import dataclass
from uuid import UUID

import httpx

from ...extensions import db
from ...models import AgentRun, ContextCheckpoint, Message, ModelConfiguration
from ..model_credentials import decrypt_api_key
from .prompts import COMPACTION_INSTRUCTIONS
from .runs import append_event

COMPACTION_RATIO = 0.70


@dataclass(frozen=True)
class PreparedContext:
    messages: list[dict[str, str]]
    estimated_tokens: int
    compacted: bool


def estimate_tokens(text: str) -> int:
    ascii_count = sum(character.isascii() for character in text)
    non_ascii_count = len(text) - ascii_count
    return max(1, math.ceil(ascii_count / 4) + non_ascii_count)


def _message_content(message: Message) -> str:
    attachments = message.attachments or []
    if not attachments:
        return message.content
    lines = [
        "Attached files (use the exact local paths when inspecting them):",
        *(f"- {item['name']}: {item['path']}" for item in attachments),
    ]
    return f"{message.content}\n\n" + "\n".join(lines)


def _context_tokens(messages: list[dict[str, str]]) -> int:
    return estimate_tokens(json.dumps(messages, ensure_ascii=False))


def _run_context_message(run: AgentRun, protected: bool) -> dict[str, str]:
    summary = run.summary
    if not protected and summary and summary.status == "completed" and summary.summary:
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
    return set(completed[-2:])


def _render_messages(messages: list[Message], protected_run_ids: set[UUID]) -> list[dict]:
    rendered: list[dict] = []
    for message in messages:
        if message.role == "assistant" and message.agent_run_id:
            run = db.session.get(AgentRun, message.agent_run_id)
            if run and run.status == "completed":
                rendered.append(_run_context_message(run, run.id in protected_run_ids))
        rendered.append({"role": message.role, "content": _message_content(message)})
    return rendered


def _protected_start(messages: list[Message], protected_run_ids: set[UUID]) -> int:
    starts = [
        index
        for index, message in enumerate(messages)
        if message.role == "user" and index == len(messages) - 1
    ]
    for index, message in enumerate(messages):
        if message.agent_run_id in protected_run_ids:
            user_index = next(
                (
                    candidate
                    for candidate in range(index - 1, -1, -1)
                    if messages[candidate].role == "user"
                ),
                index,
            )
            starts.append(user_index)
    return min(starts, default=len(messages))


def latest_checkpoint(conversation_id: UUID) -> ContextCheckpoint | None:
    return db.session.scalar(
        db.select(ContextCheckpoint)
        .where(ContextCheckpoint.conversation_id == conversation_id)
        .order_by(ContextCheckpoint.created_at.desc())
    )


def _summary_request(
    model: ModelConfiguration,
    content: str,
    instructions: str = COMPACTION_INSTRUCTIONS,
) -> str:
    response = httpx.post(
        f"{model.base_url.rstrip('/')}/chat/completions",
        headers={
            "Authorization": f"Bearer {decrypt_api_key(model.api_key_encrypted)}",
            "Content-Type": "application/json",
        },
        json={
            "model": model.model,
            "stream": False,
            "messages": [
                {
                    "role": "system",
                    "content": instructions,
                },
                {"role": "user", "content": content},
            ],
        },
        timeout=120,
    )
    response.raise_for_status()
    payload = response.json()
    return str(payload["choices"][0]["message"]["content"]).strip()


def iter_prepare_context(
    run: AgentRun,
    model: ModelConfiguration,
    messages: list[Message],
    system_instructions: str = "",
) -> Generator[dict, None, PreparedContext]:
    checkpoint = latest_checkpoint(run.conversation_id)
    source_start = _message_index(messages, checkpoint.covered_message_id if checkpoint else None)
    active_messages = messages[source_start:]
    checkpoint_summary = checkpoint.summary if checkpoint else None
    protected_run_ids = _protected_run_ids(messages)
    rendered_messages = _render_messages(active_messages, protected_run_ids)
    estimated = _context_tokens(rendered_messages)
    estimated += estimate_tokens(system_instructions) if system_instructions else 0
    estimated += estimate_tokens(checkpoint_summary) if checkpoint_summary else 0

    threshold = int(model.context_length * COMPACTION_RATIO)
    compacted = False
    if estimated >= threshold:
        split = _protected_start(active_messages, protected_run_ids)
        if split > 0:
            append_event(
                run,
                "context.compaction.started",
                {"estimatedTokens": estimated, "contextLength": model.context_length},
            )
            db.session.commit()
            yield {
                "type": "context.compaction.started",
                "estimatedTokens": estimated,
                "contextLength": model.context_length,
            }
            summary = _summary_request(
                model,
                "\n\n".join(
                    part
                    for part in (
                        (
                            f"PREVIOUS CHECKPOINT:\n{checkpoint_summary}"
                            if checkpoint_summary
                            else ""
                        ),
                        "HISTORY TO COMPACT:\n"
                        + json.dumps(
                            _render_messages(active_messages[:split], set()),
                            ensure_ascii=False,
                        ),
                    )
                    if part
                ),
            )
            covered_message = active_messages[split - 1]
            covered_run = next(
                (
                    db.session.get(AgentRun, item.agent_run_id)
                    for item in reversed(active_messages[:split])
                    if item.agent_run_id
                ),
                None,
            )
            checkpoint = ContextCheckpoint(
                run=run,
                conversation_id=run.conversation_id,
                covered_message_id=covered_message.id,
                covered_run_id=covered_run.id if covered_run else None,
                covered_event_sequence=(covered_run.last_event_sequence if covered_run else 0),
                estimated_tokens=estimate_tokens(summary),
                summary=summary,
                state={"compactionRatio": COMPACTION_RATIO, "version": 2},
            )
            db.session.add(checkpoint)
            db.session.flush()
            append_event(
                run,
                "context.compacted",
                {
                    "checkpointId": str(checkpoint.id),
                    "coveredMessageId": str(covered_message.id),
                    "coveredRunId": str(covered_run.id) if covered_run else None,
                    "coveredEventSequence": (covered_run.last_event_sequence if covered_run else 0),
                },
            )
            db.session.commit()
            checkpoint_summary = summary
            active_messages = active_messages[split:]
            rendered_messages = _render_messages(active_messages, protected_run_ids)
            estimated = (
                estimate_tokens(system_instructions)
                + estimate_tokens(summary)
                + _context_tokens(rendered_messages)
            )
            compacted = True
            yield {
                "type": "context.compaction.completed",
                "estimatedTokens": estimated,
                "contextLength": model.context_length,
            }

    result: list[dict[str, str]] = []
    if checkpoint_summary:
        result.append(
            {"role": "system", "content": f"Conversation checkpoint:\n{checkpoint_summary}"}
        )
    result.extend(_render_messages(active_messages, protected_run_ids))
    return PreparedContext(result, estimated, compacted)


def prepare_context(
    run: AgentRun,
    model: ModelConfiguration,
    messages: list[Message],
    system_instructions: str = "",
) -> PreparedContext:
    iterator = iter_prepare_context(run, model, messages, system_instructions)
    while True:
        try:
            next(iterator)
        except StopIteration as completed:
            return completed.value
