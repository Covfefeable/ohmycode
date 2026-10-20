"""Read-only diagnostics of provider requests, separate from runtime context."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import UUID

from ...extensions import db
from ...models import AgentRun, Conversation, ModelExecution
from ..devices import DeviceContext
from ..projects.queries import require_device_conversation

if TYPE_CHECKING:
    from .provider_stream import PreparedCompletion


def snapshot_body(value: object) -> object:
    if isinstance(value, list):
        return [snapshot_body(item) for item in value]
    if not isinstance(value, dict):
        return value
    if value.get("type") == "image_url":
        image = value["image_url"]
        url = image["url"]
        if url.startswith("data:"):
            header, encoded = url.split(",", 1)
            return {
                **value,
                "image_url": {
                    **image,
                    "url": f"[{header}; {len(encoded)} encoded characters omitted]",
                },
            }
    return {key: snapshot_body(item) for key, item in value.items()}


def record_request(prepared: PreparedCompletion, payload: dict) -> None:
    if prepared.execution_id is None:
        return
    db.session.execute(
        db.select(Conversation.id)
        .where(Conversation.id == prepared.conversation_id)
        .with_for_update()
    )
    execution = db.session.get(ModelExecution, prepared.execution_id)
    # One snapshot per conversation, not another full copy for every tool round.
    db.session.execute(
        db.update(ModelExecution)
        .where(
            ModelExecution.run_id.in_(
                db.select(AgentRun.id).where(AgentRun.conversation_id == prepared.conversation_id)
            ),
            ModelExecution.id != execution.id,
            ModelExecution.request_snapshot.is_not(None),
        )
        .values(request_snapshot=None)
    )
    execution.request_snapshot = {
        "capturedAt": datetime.now(UTC).isoformat(),
        "runId": str(prepared.run_id),
        "executionId": str(execution.id),
        "step": execution.step,
        "body": snapshot_body(payload),
        "estimatedTokens": prepared.estimated_input_tokens,
        "contextLength": prepared.context_length,
        "compacted": prepared.compacted,
        "messageCount": len(payload.get("messages", [])),
        "toolCount": len(payload.get("tools", [])),
        "requestBytes": len(json.dumps(payload, ensure_ascii=False).encode()),
        "usage": None,
    }
    db.session.commit()


def record_request_usage(execution_id: UUID | None, usage: dict) -> None:
    if execution_id is None or not usage:
        return
    execution = db.session.scalar(
        db.select(ModelExecution)
        .where(ModelExecution.id == execution_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if execution.request_snapshot is not None:
        execution.request_snapshot = {**execution.request_snapshot, "usage": usage}
    db.session.commit()


def get_request_snapshot(user_id: UUID, device: DeviceContext, conversation_id: UUID) -> dict:
    conversation = require_device_conversation(user_id, device, conversation_id)
    execution = db.session.scalar(
        db.select(ModelExecution)
        .join(AgentRun)
        .where(
            AgentRun.conversation_id == conversation.id,
            ModelExecution.request_snapshot.is_not(None),
        )
        .order_by(ModelExecution.created_at.desc(), ModelExecution.step.desc())
        .limit(1)
    )
    return {
        "conversationId": str(conversation.id),
        "title": conversation.title,
        "snapshot": {**execution.request_snapshot, "status": execution.status}
        if execution
        else None,
    }
