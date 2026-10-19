"""Submission and replay. HTTP subscribers never own provider execution."""

import hashlib
import json
import time
from uuid import UUID

from flask import current_app

from ...extensions import db
from ...models import AgentRun, Conversation, Message, ModelExecution, ModelStreamEvent
from ..conversations import get_conversation
from ..errors import ServiceError
from .preparation import create_completion_run
from .prompts import AGENT_SYSTEM_INSTRUCTIONS
from .result_references import protect_result_references
from .runs import append_event, get_owned_run
from .tool_snapshot import validate_tool_snapshot


def latest_execution(run_id: UUID) -> ModelExecution | None:
    return db.session.scalar(
        db.select(ModelExecution)
        .where(ModelExecution.run_id == run_id)
        .order_by(ModelExecution.step.desc())
        .limit(1)
    )


def dispatch_execution(execution_id: UUID) -> None:
    from ...tasks.agent_execution import execute_model_request

    try:
        execute_model_request.delay(str(execution_id))
    except Exception:
        # The committed queue entry is an outbox; Beat republishes it if the broker is down.
        current_app.logger.exception("Unable to dispatch model execution %s", execution_id)


def _submit(run: AgentRun, key: str, parameters: dict) -> UUID:
    protect_result_references(parameters)
    previous = latest_execution(run.id)
    execution = ModelExecution(
        run_id=run.id,
        request_key=key,
        parameters=parameters,
        step=previous.step + 1 if previous else 0,
    )
    db.session.add(execution)
    db.session.flush()
    if key == "initial":
        user_message = db.session.scalar(
            db.select(Message)
            .where(Message.conversation_id == run.conversation_id, Message.role == "user")
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        execution.last_sequence = 1
        db.session.add(
            ModelStreamEvent(
                execution_id=execution.id,
                sequence=1,
                payload={
                    "type": "run.started",
                    "runId": str(run.id),
                    "messageId": str(user_message.id),
                },
            )
        )
    db.session.commit()
    execution_id = execution.id
    dispatch_execution(execution_id)
    return execution_id


def start_execution(
    user_id: UUID,
    conversation_id: UUID,
    content: str,
    model_id: str | None,
    edit_message_id: str | None = None,
    workspace_instructions: str = "",
    turn_id: UUID | None = None,
    attachments: object = None,
    tool_snapshot: object = None,
    system_instructions: str = AGENT_SYSTEM_INSTRUCTIONS,
) -> UUID:
    get_conversation(user_id, conversation_id)
    db.session.scalar(
        db.select(Conversation).where(Conversation.id == conversation_id).with_for_update()
    )
    if turn_id is not None and db.session.get(AgentRun, turn_id):
        run = get_owned_run(user_id, turn_id)
        if run.conversation_id != conversation_id:
            raise ServiceError("invalid_turn_id", 409)
        execution = latest_execution(run.id)
        if execution:
            execution_id = execution.id
            db.session.commit()
            return execution_id
        raise ServiceError("invalid_run_state", 409)
    run = create_completion_run(
        user_id,
        conversation_id,
        content,
        model_id,
        edit_message_id,
        turn_id=turn_id,
        attachments=attachments,
        tool_snapshot=tool_snapshot,
    )
    return _submit(
        run,
        "initial",
        {
            "workspace_instructions": workspace_instructions,
            "system_instructions": system_instructions,
            "tools": run.tool_snapshot,
        },
    )


def resume_execution(
    user_id: UUID,
    run_id: UUID,
    results: list[dict],
    workspace_instructions: str = "",
    tool_snapshot: object = None,
    system_instructions: str = AGENT_SYSTEM_INSTRUCTIONS,
) -> UUID:
    get_owned_run(user_id, run_id)
    run = db.session.scalar(
        db.select(AgentRun)
        .where(AgentRun.id == run_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    tools = validate_tool_snapshot(tool_snapshot)
    identifiers = [str(item.get("callId")) for item in results]
    key = hashlib.sha256(json.dumps(sorted(identifiers)).encode()).hexdigest()
    existing = db.session.scalar(
        db.select(ModelExecution).where(
            ModelExecution.run_id == run.id, ModelExecution.request_key == key
        )
    )
    if existing:
        execution_id = existing.id
        db.session.commit()
        return execution_id
    requested = next(
        (event for event in reversed(run.events) if event.event_type == "tool.requested"), None
    )
    expected = {call["id"] for call in requested.payload["toolCalls"]} if requested else set()
    if run.status != "waiting_tool":
        raise ServiceError("invalid_run_state", 409)
    if not results or len(identifiers) != len(expected) or set(identifiers) != expected:
        raise ServiceError("invalid_tool_results", 422)
    append_event(run, "tool.output", {"results": results})
    run.status = "running"
    run.tool_snapshot = tools
    return _submit(
        run,
        key,
        {
            "workspace_instructions": workspace_instructions,
            "system_instructions": system_instructions,
            "tools": tools,
        },
    )


def recover_execution(
    user_id: UUID,
    run_id: UUID,
    workspace_instructions: str = "",
    results: list[dict] | None = None,
    tool_snapshot: object = None,
    system_instructions: str = AGENT_SYSTEM_INSTRUCTIONS,
) -> UUID:
    run = get_owned_run(user_id, run_id)
    if results:
        return resume_execution(
            user_id, run_id, results, workspace_instructions, tool_snapshot, system_instructions
        )
    execution = latest_execution(run.id)
    if not execution:
        raise ServiceError("invalid_run_state", 409)
    return execution.id


def continue_execution(
    user_id: UUID,
    run_id: UUID,
    execution_id: UUID,
    workspace_instructions: str,
    tool_snapshot: object,
) -> UUID:
    get_owned_run(user_id, run_id)
    run = db.session.scalar(
        db.select(AgentRun)
        .where(AgentRun.id == run_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    key = f"steer:{execution_id}"
    existing = db.session.scalar(
        db.select(ModelExecution).where(
            ModelExecution.run_id == run_id, ModelExecution.request_key == key
        )
    )
    if existing:
        return existing.id
    previous = latest_execution(run_id)
    if (
        run.status != "running"
        or not previous
        or previous.id != execution_id
        or previous.status != "completed"
    ):
        raise ServiceError("invalid_run_state", 409)
    return _submit(
        run,
        key,
        {
            "workspace_instructions": workspace_instructions,
            "system_instructions": AGENT_SYSTEM_INSTRUCTIONS,
            "tools": validate_tool_snapshot(tool_snapshot),
        },
    )


def subscribe_execution(execution_id: UUID):
    """Replay the current model request, then tail it. Closing this iterator has no side effects."""
    sequence = 0
    heartbeat_at = time.monotonic()
    while True:
        # Release the connection while waiting and start a fresh read transaction each poll.
        db.session.remove()
        snapshot = db.session.execute(
            db.select(ModelExecution, AgentRun.status)
            .join(AgentRun, ModelExecution.run_id == AgentRun.id)
            .where(ModelExecution.id == execution_id)
        ).first()
        if snapshot is None:
            yield 'data: {"type":"run.failed","errorCode":"not_found"}\n\n'
            break
        execution, run_status = snapshot
        if run_status == "cancelled":
            db.session.remove()
            break
        status = execution.status
        events = list(
            db.session.scalars(
                db.select(ModelStreamEvent)
                .where(
                    ModelStreamEvent.execution_id == execution_id,
                    ModelStreamEvent.sequence > sequence,
                )
                .order_by(ModelStreamEvent.sequence)
                .limit(256)
            )
        )
        frames = [
            (event.sequence, json.dumps(event.payload, ensure_ascii=False)) for event in events
        ]
        db.session.remove()
        for sequence, payload in frames:
            yield f"id: {execution_id}:{sequence}\ndata: {payload}\n\n"
        if frames:
            continue
        if status not in {"queued", "running"}:
            break
        if time.monotonic() - heartbeat_at >= 10:
            yield ": heartbeat\n\n"
            heartbeat_at = time.monotonic()
        time.sleep(0.1)
    yield "data: [DONE]\n\n"
