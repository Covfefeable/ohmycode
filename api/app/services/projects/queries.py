from uuid import UUID

from ...extensions import db
from ...models import Conversation, Project


def owned_project(user_id: UUID, project_id: UUID) -> Project | None:
    return db.session.scalar(
        db.select(Project).where(Project.id == project_id, Project.user_id == user_id)
    )


def owned_conversation(user_id: UUID, conversation_id: UUID) -> Conversation | None:
    return db.session.scalar(
        db.select(Conversation)
        .join(Project)
        .where(Conversation.id == conversation_id, Project.user_id == user_id)
    )
