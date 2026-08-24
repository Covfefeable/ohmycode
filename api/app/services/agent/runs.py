from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func

from ...extensions import db
from ...models import AgentEvent, AgentRun, Conversation, Message, ModelConfiguration, Project
from ..errors import ServiceError
from .prompts import STOPPED_RUN_CONTEXT


def start_run(conversation_id: UUID, model: ModelConfiguration) -> AgentRun:
    run = AgentRun(conversation_id=conversation_id, model_configuration_id=model.id)
    db.session.add(run)
    db.session.flush()
    append_event(run, "run.started", {"modelId": str(model.id)})
    db.session.commit()
    return run


def append_event(run: AgentRun, event_type: str, payload: dict | None = None) -> AgentEvent:
    run.last_event_sequence += 1
    event = AgentEvent(
        run=run, sequence=run.last_event_sequence, event_type=event_type, payload=payload or {}
    )
    db.session.add(event)
    return event


def get_owned_run(user_id: UUID, run_id: UUID) -> AgentRun:
    run = db.session.scalar(
        db.select(AgentRun)
        .join(Conversation, AgentRun.conversation_id == Conversation.id)
        .join(Project, Conversation.project_id == Project.id)
        .where(AgentRun.id == run_id, Project.user_id == user_id)
    )
    if not run:
        raise ServiceError("not_found", 404)
    return run


def complete_run(run: AgentRun, message_id: UUID) -> None:
    append_event(run, "message.completed", {"messageId": str(message_id)})
    append_event(run, "run.completed")
    run.status = "completed"
    run.completed_at = datetime.now(UTC)
    db.session.commit()


def fail_run(run: AgentRun, error_code: str) -> None:
    append_event(run, "run.failed", {"errorCode": error_code})
    run.status = "failed"
    run.error_code = error_code[:1000]
    run.completed_at = datetime.now(UTC)
    db.session.commit()


def cancel_run(user_id: UUID, run_id: UUID, partial_message: object = None) -> None:
    run = get_owned_run(user_id, run_id)
    if run.status in {"completed", "failed", "cancelled"}:
        return
    append_event(run, "run.cancelled", {"reason": "user_requested"})
    run.status = "cancelled"
    run.completed_at = datetime.now(UTC)
    if isinstance(partial_message, dict) and not db.session.scalar(
        db.select(Message.id).where(Message.agent_run_id == run.id)
    ):
        content = str(partial_message.get("content") or "").strip()
        activity = partial_message.get("activity")
        db.session.add(
            Message(
                conversation_id=run.conversation_id,
                agent_run_id=run.id,
                role="assistant",
                content=content,
                activity=activity if isinstance(activity, list) else None,
            )
        )
    db.session.commit()


def cancelled_run_context(conversation_id: UUID, current_run_id: UUID) -> list[dict[str, str]]:
    cancelled_count = db.session.scalar(
        db.select(func.count(AgentRun.id)).where(
            AgentRun.conversation_id == conversation_id,
            AgentRun.id != current_run_id,
            AgentRun.status == "cancelled",
        )
    )
    if not cancelled_count:
        return []
    return [
        {
            "role": "system",
            "content": f"{STOPPED_RUN_CONTEXT} Interrupted runs recorded: {cancelled_count}.",
        }
    ]
