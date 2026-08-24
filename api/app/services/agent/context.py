import math
from dataclasses import dataclass
from uuid import UUID

import httpx

from ...extensions import db
from ...models import AgentRun, ContextCheckpoint, Message, ModelConfiguration
from ..model_credentials import decrypt_api_key
from .prompts import COMPACTION_INSTRUCTIONS
from .runs import append_event

COMPACTION_RATIO = 0.70
RECENT_CONTEXT_RATIO = 0.20


@dataclass(frozen=True)
class PreparedContext:
    messages: list[dict[str, str]]
    estimated_tokens: int
    compacted: bool


def estimate_tokens(text: str) -> int:
    ascii_count = sum(character.isascii() for character in text)
    non_ascii_count = len(text) - ascii_count
    return max(1, math.ceil(ascii_count / 4) + non_ascii_count)


def _message_tokens(message: Message) -> int:
    return estimate_tokens(message.content) + 4


def latest_checkpoint(conversation_id: UUID) -> ContextCheckpoint | None:
    return db.session.scalar(
        db.select(ContextCheckpoint)
        .where(ContextCheckpoint.conversation_id == conversation_id)
        .order_by(ContextCheckpoint.created_at.desc())
    )


def _summary_request(model: ModelConfiguration, content: str) -> str:
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
                    "content": COMPACTION_INSTRUCTIONS,
                },
                {"role": "user", "content": content},
            ],
        },
        timeout=120,
    )
    response.raise_for_status()
    payload = response.json()
    return str(payload["choices"][0]["message"]["content"]).strip()


def _render_for_summary(summary: str | None, messages: list[Message]) -> str:
    parts = []
    if summary:
        parts.append(f"PREVIOUS CHECKPOINT:\n{summary}")
    parts.extend(f"{message.role.upper()}:\n{message.content}" for message in messages)
    return "\n\n".join(parts)


def prepare_context(
    run: AgentRun,
    model: ModelConfiguration,
    messages: list[Message],
    system_instructions: str = "",
) -> PreparedContext:
    checkpoint = latest_checkpoint(run.conversation_id)
    if checkpoint and checkpoint.source_message_count > len(messages):
        checkpoint = None
    source_count = checkpoint.source_message_count if checkpoint else 0
    active_messages = messages[source_count:]
    checkpoint_summary = checkpoint.summary if checkpoint else None
    estimated = sum(_message_tokens(message) for message in active_messages)
    estimated += estimate_tokens(system_instructions) if system_instructions else 0
    if checkpoint_summary:
        estimated += estimate_tokens(checkpoint_summary)

    threshold = int(model.context_length * COMPACTION_RATIO)
    compacted = False
    if estimated >= threshold and len(active_messages) > 2:
        recent_budget = max(1, int(model.context_length * RECENT_CONTEXT_RATIO))
        recent_tokens = 0
        split = len(active_messages)
        while split > 0:
            candidate_tokens = _message_tokens(active_messages[split - 1])
            if recent_tokens + candidate_tokens > recent_budget and split < len(active_messages):
                break
            recent_tokens += candidate_tokens
            split -= 1
        if split > 0:
            summary = _summary_request(
                model,
                _render_for_summary(checkpoint_summary, active_messages[:split]),
            )
            source_count += split
            checkpoint = ContextCheckpoint(
                run=run,
                conversation_id=run.conversation_id,
                source_message_count=source_count,
                estimated_tokens=estimate_tokens(summary),
                summary=summary,
                state={"compactionRatio": COMPACTION_RATIO},
            )
            db.session.add(checkpoint)
            db.session.flush()
            append_event(
                run,
                "context.compacted",
                {
                    "checkpointId": str(checkpoint.id),
                    "sourceMessageCount": source_count,
                },
            )
            db.session.commit()
            checkpoint_summary = summary
            active_messages = messages[source_count:]
            estimated = (
                estimate_tokens(system_instructions)
                + estimate_tokens(summary)
                + sum(_message_tokens(message) for message in active_messages)
            )
            compacted = True

    result: list[dict[str, str]] = []
    if checkpoint_summary:
        result.append(
            {"role": "system", "content": f"Conversation checkpoint:\n{checkpoint_summary}"}
        )
    result.extend({"role": item.role, "content": item.content} for item in active_messages)
    return PreparedContext(result, estimated, compacted)


def compact_payload(
    run: AgentRun,
    model: ModelConfiguration,
    messages: list[dict],
    source_message_count: int,
    state: dict,
) -> str:
    transcript = "\n\n".join(
        f"{item.get('role', 'unknown').upper()}:\n{json_text}"
        for item in messages
        if (json_text := str(item.get("content") or item.get("tool_calls") or ""))
    )
    summary = _summary_request(model, transcript)
    checkpoint = ContextCheckpoint(
        run=run,
        conversation_id=run.conversation_id,
        source_message_count=source_message_count,
        estimated_tokens=estimate_tokens(summary),
        summary=summary,
        state={"compactionRatio": COMPACTION_RATIO, **state},
    )
    db.session.add(checkpoint)
    db.session.flush()
    append_event(
        run,
        "context.compacted",
        {"checkpointId": str(checkpoint.id), "sourceMessageCount": source_message_count},
    )
    db.session.commit()
    return summary
