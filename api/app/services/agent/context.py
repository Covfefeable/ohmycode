import json
import math
from collections.abc import Generator
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

import httpx

from ...extensions import db
from ...models import (
    AgentEvent,
    AgentRun,
    ContextCheckpoint,
    Message,
    ModelConfiguration,
)
from ..errors import ServiceError
from ..model_credentials import decrypt_api_key
from ..settings.background_tasks import (
    background_task_settings,
    configured_model,
    conversation_user_id,
)
from .config import TOOL_RESULT_TOKEN_BUDGET
from .context_history import (
    ContextBlock,
    _conversation_blocks,
    _message_index,
    _protected_run_ids,
    mailbox_blocks,
)
from .image_context import text_only_images
from .prompts import COMPACTION_INSTRUCTIONS
from .result_references import protect_result_references
from .runs import append_event
from .tokens import estimate_tokens, request_tokens
from .tool_history import tool_batches
from .tool_results import slice_to_token_budget

COMPACTION_RATIO = 0.70


@dataclass(frozen=True)
class PreparedContext:
    messages: list[dict]
    estimated_tokens: int
    compacted: bool


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
    *,
    max_tokens: int | None = None,
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
            **({"max_tokens": max_tokens} if max_tokens is not None else {}),
        },
        timeout=120,
    )
    response.raise_for_status()
    payload = response.json()
    summary = str(payload["choices"][0]["message"]["content"] or "").strip()
    if not summary or payload["choices"][0].get("finish_reason") == "length":
        raise ValueError("incomplete_context_summary")
    return summary


def iter_prepare_context(
    run: AgentRun,
    model: ModelConfiguration,
    messages: list[Message],
    prefix: list[dict],
    tools: list[dict],
    continuation: list[dict],
) -> Generator[dict, None, PreparedContext]:
    checkpoint = latest_checkpoint(run.conversation_id)
    user_id = conversation_user_id(run.conversation_id)
    background_settings = background_task_settings(user_id)
    threshold = int(model.context_length * background_settings.context_compaction_ratio)
    factor = _token_calibration(model)
    source_start = _message_index(messages, checkpoint.covered_message_id if checkpoint else None)
    blocks = _conversation_blocks(messages[source_start:], _protected_run_ids(messages), checkpoint)
    mailbox_cursor = int(checkpoint.state.get("mailboxSequence", 0)) if checkpoint else 0
    blocks = [*mailbox_blocks(run.conversation_id, mailbox_cursor), *blocks]
    after_sequence = (
        checkpoint.covered_event_sequence
        if checkpoint and checkpoint.covered_run_id == run.id
        else 0
    )
    retained_tokens = request_tokens(
        _assemble(prefix, " ", [block for block in blocks if block.keep], continuation), tools
    )
    latest_output = next(
        (event for event in reversed(run.events) if event.event_type == "tool.output"), None
    )
    result_count = len(latest_output.payload["results"]) if latest_output else 0
    # Share the remaining input budget between the latest results and a checkpoint.
    result_budget = min(
        TOOL_RESULT_TOKEN_BUDGET,
        max(0, int(threshold / factor) - retained_tokens) // (result_count + 1),
    )
    batches = tool_batches(run, after_sequence, result_budget)
    latest_input_sequence = next(
        (event.sequence for event in reversed(run.events) if event.event_type == "input.received"),
        0,
    )
    blocks.extend(
        ContextBlock(
            batch.messages,
            {"covered_run_id": run.id, "covered_event_sequence": batch.sequence},
            keep=index == len(batches) - 1 or batch.sequence == latest_input_sequence,
        )
        for index, batch in enumerate(batches)
    )
    summary = checkpoint.summary if checkpoint else ""
    result = _assemble(prefix, summary, blocks, continuation)
    raw_tokens = request_tokens(result, tools)
    estimated = math.ceil(raw_tokens * factor)
    compacted = False
    eligible = [block for block in blocks if not block.keep]
    if estimated >= threshold and (eligible or summary):
        retained = [block for block in blocks if block.keep]
        retained_tokens = request_tokens(_assemble(prefix, " ", retained, continuation), tools)
        summary_budget = int(threshold / factor) - retained_tokens
        if summary_budget <= 0:
            raise ServiceError("context_budget_exceeded", 422)
        event = {"estimatedTokens": estimated, "contextLength": model.context_length}
        append_event(run, "context.compaction.started", event)
        db.session.commit()
        yield {"type": "context.compaction.started", **event}
        compaction_model = (
            configured_model(user_id, background_settings.context_compaction_model_id) or model
        )
        summary = _compact_blocks(
            compaction_model,
            summary,
            eligible,
            summary_budget,
            background_settings.context_compaction_ratio,
        )
        result = _assemble(prefix, summary, retained, continuation)
        raw_tokens = request_tokens(result, tools)
        estimated = math.ceil(raw_tokens * factor)
        if estimated >= model.context_length:
            raise ServiceError("context_budget_exceeded", 422)
        cursor = {
            "covered_message_id": checkpoint.covered_message_id if checkpoint else None,
            "covered_run_id": checkpoint.covered_run_id if checkpoint else None,
            "covered_event_sequence": checkpoint.covered_event_sequence if checkpoint else 0,
            "mailboxSequence": mailbox_cursor,
        }
        for block in eligible:
            cursor.update(block.cursor)
        protect_result_references(summary)
        checkpoint = ContextCheckpoint(
            run=run,
            conversation_id=run.conversation_id,
            covered_message_id=cursor["covered_message_id"],
            covered_run_id=cursor["covered_run_id"],
            covered_event_sequence=cursor["covered_event_sequence"],
            estimated_tokens=estimate_tokens(summary),
            summary=summary,
            state={"mailboxSequence": cursor["mailboxSequence"]},
            created_at=datetime.now(UTC),
        )
        db.session.add(checkpoint)
        db.session.flush()
        append_event(run, "context.compacted", {"checkpointId": str(checkpoint.id)})
        compacted = True
        db.session.commit()
        yield {
            "type": "context.compaction.completed",
            "estimatedTokens": estimated,
            "contextLength": model.context_length,
        }
    if estimated >= model.context_length:
        raise ServiceError("context_budget_exceeded", 422)
    return PreparedContext(result, raw_tokens, compacted)


def _assemble(
    prefix: list[dict], summary: str, blocks: list[ContextBlock], continuation: list[dict]
) -> list[dict]:
    return [
        *prefix,
        *(
            [{"role": "system", "content": f"Conversation checkpoint:\n{summary}"}]
            if summary
            else []
        ),
        *(message for block in blocks for message in block.messages),
        *continuation,
    ]


def _token_calibration(model: ModelConfiguration) -> float:
    usage = db.session.scalar(
        db.select(AgentEvent)
        .join(AgentRun)
        .where(
            AgentRun.model_configuration_id == model.id,
            AgentEvent.event_type == "context.usage",
            AgentEvent.payload["model"].as_string() == model.model,
            AgentEvent.payload["estimatedTokens"].as_integer() > 0,
        )
        .order_by(AgentRun.started_at.desc(), AgentEvent.sequence.desc())
        .limit(1)
    )
    return (
        max(1.0, usage.payload["usedTokens"] / usage.payload["estimatedTokens"]) if usage else 1.0
    )


def _compact_blocks(
    model: ModelConfiguration,
    summary: str,
    blocks: list[ContextBlock],
    budget: int,
    input_ratio: float,
) -> str:
    content = json.dumps(
        text_only_images(
            [{"cursor": block.cursor, "messages": block.messages} for block in blocks]
        ),
        ensure_ascii=False,
        default=str,
    )
    output_budget = max(1, model.context_length - int(model.context_length * input_ratio))
    max_tokens = min(budget, output_budget, estimate_tokens(summary + content))
    cursor = 0
    while cursor < len(content):
        prefix = f"PREVIOUS CHECKPOINT:\n{summary}\n\nHISTORY TO COMPACT:\n"

        def measure(page: str) -> int:
            return request_tokens(
                [
                    {"role": "system", "content": COMPACTION_INSTRUCTIONS},
                    {"role": "user", "content": prefix + page},
                ],
                [],
            )

        page, end = slice_to_token_budget(
            content, cursor, model.context_length - max_tokens, measure=measure
        )
        if not page:
            raise ServiceError("context_budget_exceeded", 422)
        summary = _summary_request(model, prefix + page, max_tokens=max_tokens)
        if not summary or estimate_tokens(summary) > max_tokens:
            raise ValueError("invalid_context_summary")
        cursor = end
    return summary
