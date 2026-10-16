from uuid import UUID

from ...extensions import db
from ...models import Conversation, Message, Project
from ..devices import DeviceContext


def _escaped_pattern(query: str) -> str:
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def search_conversations(
    user_id: UUID,
    device: DeviceContext,
    query: str,
    limit: int = 30,
) -> list[tuple[Conversation, str | None]]:
    normalized = query.strip()[:200]
    if not normalized:
        return []
    pattern = _escaped_pattern(normalized)
    conversations = list(
        db.session.scalars(
            db.select(Conversation)
            .join(Project)
            .outerjoin(Message)
            .where(
                Project.user_id == user_id,
                Project.device_id == device.id,
                Project.kind == "workspace",
                Conversation.kind == "chat",
                db.or_(
                    Conversation.title.ilike(pattern, escape="\\"),
                    Message.content.ilike(pattern, escape="\\"),
                ),
            )
            .distinct()
            .order_by(Conversation.updated_at.desc())
            .limit(max(1, min(limit, 50)))
        )
    )
    if not conversations:
        return []
    matching_messages = db.session.execute(
        db.select(Message.conversation_id, Message.content)
        .where(
            Message.conversation_id.in_([item.id for item in conversations]),
            Message.content.ilike(pattern, escape="\\"),
        )
        .order_by(Message.created_at.desc())
    )
    snippets: dict[UUID, str] = {}
    for conversation_id, content in matching_messages:
        snippets.setdefault(conversation_id, content.strip().replace("\n", " ")[:180])
    return [(conversation, snippets.get(conversation.id)) for conversation in conversations]
