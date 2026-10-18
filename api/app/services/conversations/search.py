from uuid import UUID

from sqlalchemy import tuple_
from sqlalchemy.orm import contains_eager

from ...extensions import db
from ...models import Conversation, Message, Project
from ..devices import DeviceContext
from ..errors import ServiceError
from ..projects.queries import device_conversation


def _escaped_pattern(query: str) -> str:
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def search_conversations(
    user_id: UUID,
    device: DeviceContext,
    query: str,
    limit: int = 30,
) -> list[tuple[Conversation, Message | None]]:
    normalized = query.strip()[:200]
    if not normalized:
        return []
    pattern = _escaped_pattern(normalized)
    matching_message = (
        db.select(Message.id)
        .where(
            Message.conversation_id == Conversation.id, Message.content.ilike(pattern, escape="\\")
        )
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(1)
        .correlate(Conversation)
        .scalar_subquery()
    )
    return list(
        db.session.execute(
            db.select(Conversation, Message)
            .join(Project)
            .outerjoin(Message, Message.id == matching_message)
            .options(contains_eager(Conversation.project))
            .where(
                Project.user_id == user_id,
                Project.device_id == device.id,
                Project.kind == "workspace",
                Conversation.kind == "chat",
                db.or_(
                    Conversation.title.ilike(pattern, escape="\\"),
                    Message.id.is_not(None),
                ),
            )
            .order_by(Conversation.updated_at.desc())
            .limit(max(1, min(limit, 50)))
        )
    )


def search_messages(
    user_id: UUID,
    device: DeviceContext,
    conversation_id: UUID,
    query: str,
    at: UUID | None = None,
    direction: str | None = None,
) -> dict:
    if not device_conversation(user_id, device, conversation_id):
        raise ServiceError("not_found", 404)
    if direction not in {None, "next", "previous"}:
        raise ServiceError("validation_error", 422)
    normalized = query.strip()[:200]
    if not normalized:
        return {"messageId": None, "position": 0, "total": 0}
    query = db.select(Message).where(
        Message.conversation_id == conversation_id,
        Message.content.ilike(_escaped_pattern(normalized), escape="\\"),
    )
    total = db.session.scalar(db.select(db.func.count()).select_from(query.subquery()))
    anchor = db.session.get(Message, at) if at else None
    if at and (not anchor or anchor.conversation_id != conversation_id):
        raise ServiceError("invalid_history_cursor", 422)
    position = tuple_(Message.created_at, Message.id)
    ordered = (Message.created_at, Message.id)
    if direction == "previous":
        ordered = (Message.created_at.desc(), Message.id.desc())
    selected = query
    if anchor:
        cursor = (anchor.created_at, anchor.id)
        selected = selected.where(
            position > cursor
            if direction == "next"
            else position < cursor
            if direction == "previous"
            else Message.id == anchor.id
        )
    match = db.session.scalar(selected.order_by(*ordered).limit(1))
    if not match and anchor:
        match = db.session.scalar(query.order_by(*ordered).limit(1))
    if not match:
        return {"messageId": None, "position": 0, "total": total}
    index = db.session.scalar(
        db.select(db.func.count()).select_from(
            query.where(position <= (match.created_at, match.id)).subquery()
        )
    )
    return {"messageId": str(match.id), "position": index, "total": total}
