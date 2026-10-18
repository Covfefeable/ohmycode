"""User guidance owned by the current Turn, received only at model boundaries."""

from uuid import UUID

from ...extensions import db
from ...models import AgentEvent, AgentRun, Conversation, Message
from ..conversations.commands import normalize_attachments, touch_conversation
from ..errors import ServiceError
from .context_history import _message_content
from .runs import append_event, get_owned_run


def pending_inputs(run: AgentRun) -> list[AgentEvent]:
    events = list(
        db.session.scalars(
            db.select(AgentEvent)
            .where(
                AgentEvent.run_id == run.id,
                AgentEvent.event_type.in_(["input.queued", "input.received"]),
            )
            .order_by(AgentEvent.sequence)
        )
    )
    received = {
        event.payload["inputId"] for event in events if event.event_type == "input.received"
    }
    return [
        event
        for event in events
        if event.event_type == "input.queued" and event.payload["inputId"] not in received
    ]


def queue_input(
    user_id: UUID, run_id: UUID, input_id: UUID, content: str, attachments: object
) -> None:
    get_owned_run(user_id, run_id)
    run = db.session.scalar(
        db.select(AgentRun)
        .where(AgentRun.id == run_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    existing = db.session.scalar(
        db.select(AgentEvent).where(
            AgentEvent.run_id == run_id,
            AgentEvent.event_type == "input.queued",
            AgentEvent.payload["inputId"].as_string() == str(input_id),
        )
    )
    if existing:
        return
    if run.status not in {"running", "waiting_tool"}:
        raise ServiceError("turn_finished", 409)
    items = normalize_attachments(attachments or [])
    if not content.strip() and not items:
        raise ServiceError("validation_error", 422)
    append_event(
        run, "input.queued", {"inputId": str(input_id), "content": content, "attachments": items}
    )
    db.session.commit()


def receive_inputs(run: AgentRun) -> list[dict]:
    received = []
    for event in pending_inputs(run):
        payload = event.payload
        message = Message(
            conversation_id=run.conversation_id,
            agent_run_id=run.id,
            role="user",
            content=payload["content"],
            attachments=payload["attachments"] or None,
        )
        db.session.add(message)
        db.session.flush()
        data = {
            **payload,
            "messageId": str(message.id),
            "createdAt": message.created_at.isoformat(),
        }
        append_event(run, "input.received", {**data, "contextContent": _message_content(message)})
        received.append({"type": "input.received", **data})
    if received:
        touch_conversation(db.session.get(Conversation, run.conversation_id))
    return received


def input_status(user_id: UUID, run_id: UUID, input_id: UUID, initial: bool = False) -> dict:
    run = get_owned_run(user_id, run_id)
    if initial:
        return {"status": "received"}
    received = db.session.scalar(
        db.select(AgentEvent.id).where(
            AgentEvent.run_id == run_id,
            AgentEvent.event_type == "input.received",
            AgentEvent.payload["inputId"].as_string() == str(input_id),
        )
    )
    if received:
        return {"status": "received"}
    pending = any(event.payload["inputId"] == str(input_id) for event in pending_inputs(run))
    return {
        "status": "waiting"
        if pending and run.status in {"running", "waiting_tool"}
        else "not_received"
    }
