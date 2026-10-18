from uuid import UUID

from sqlalchemy import tuple_

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
    *,
    after: UUID | None = None,
    around: UUID | None = None,
) -> dict:
    conversation = device_conversation(user_id, device, conversation_id)
    if not conversation:
        raise ServiceError("not_found", 404)
    if sum(value is not None for value in (before, turn_id, after, around)) > 1:
        raise ServiceError("validation_error", 422)
    query = db.select(Message).where(Message.conversation_id == conversation_id)
    position = tuple_(Message.created_at, Message.id)
    if turn_id:
        query = query.where(Message.agent_run_id == turn_id)
    cursor_id = before or after or around
    cursor = None
    if cursor_id:
        cursor = db.session.get(Message, cursor_id)
        if not cursor or cursor.conversation_id != conversation_id:
            raise ServiceError("invalid_history_cursor", 422)
    has_newer = False
    if around:
        half = HISTORY_PAGE_SIZE // 2
        older = list(
            db.session.scalars(
                query.where(position < (cursor.created_at, cursor.id))
                .order_by(Message.created_at.desc(), Message.id.desc())
                .limit(half + 1)
            )
        )
        newer = list(
            db.session.scalars(
                query.where(position > (cursor.created_at, cursor.id))
                .order_by(Message.created_at, Message.id)
                .limit(half + 1)
            )
        )
        has_older, has_newer = len(older) > half, len(newer) > half
        messages = [*reversed(older[:half]), cursor, *newer[:half]]
    else:
        if before:
            query = query.where(position < (cursor.created_at, cursor.id))
        if after:
            query = query.where(position > (cursor.created_at, cursor.id))
        order = (
            (Message.created_at, Message.id)
            if after
            else (Message.created_at.desc(), Message.id.desc())
        )
        query = query.order_by(*order)
        # Turn completion returns only that Turn; UI history is paged independently.
        messages = list(
            db.session.scalars(query if turn_id else query.limit(HISTORY_PAGE_SIZE + 1))
        )
        more = not turn_id and len(messages) > HISTORY_PAGE_SIZE
        has_older, has_newer = more and not after, more and bool(after)
        messages = messages if turn_id else messages[:HISTORY_PAGE_SIZE]
        if not after:
            messages.reverse()
    result = serialize_conversation(conversation)
    result.update(
        messages=[serialize_message(message) for message in messages],
        olderCursor=str(messages[0].id) if has_older else None,
        newerCursor=str(messages[-1].id) if has_newer else None,
        contextUsage=latest_context_usage(conversation_id),
    )
    return result
