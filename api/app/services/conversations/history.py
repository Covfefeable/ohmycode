from uuid import UUID

from sqlalchemy import and_, or_

from ...extensions import db
from ...models import Message
from ..devices import DeviceContext
from ..errors import ServiceError
from ..projects.queries import device_conversation
from ..projects.serializers import latest_context_usage, serialize_conversation, serialize_message

HISTORY_PAGE_SIZE = 40


def conversation_history(
    user_id: UUID,
    device: DeviceContext,
    conversation_id: UUID,
    before: UUID | None = None,
    turn_id: UUID | None = None,
) -> dict:
    conversation = device_conversation(user_id, device, conversation_id)
    if not conversation:
        raise ServiceError("not_found", 404)
    query = db.select(Message).where(Message.conversation_id == conversation_id)
    if turn_id:
        query = query.where(Message.agent_run_id == turn_id)
    if before:
        cursor = db.session.get(Message, before)
        if not cursor or cursor.conversation_id != conversation_id:
            raise ServiceError("invalid_history_cursor", 422)
        query = query.where(
            or_(
                Message.created_at < cursor.created_at,
                and_(Message.created_at == cursor.created_at, Message.id < cursor.id),
            )
        )
    query = query.order_by(Message.created_at.desc(), Message.id.desc())
    # Turn completion returns only that Turn; UI history is paged independently.
    messages = list(db.session.scalars(query if turn_id else query.limit(HISTORY_PAGE_SIZE + 1)))
    has_older = not turn_id and len(messages) > HISTORY_PAGE_SIZE
    messages = list(reversed(messages if turn_id else messages[:HISTORY_PAGE_SIZE]))
    result = serialize_conversation(conversation)
    result.update(
        messages=[serialize_message(message) for message in messages],
        olderCursor=str(messages[0].id) if has_older else None,
        contextUsage=latest_context_usage(conversation_id),
    )
    return result
