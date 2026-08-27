from uuid import UUID

from ...extensions import db
from ...models import AgentRun, Conversation, Project
from ..devices import DeviceContext


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


def device_project(user_id: UUID, device: DeviceContext, project_id: UUID) -> Project | None:
    return db.session.scalar(
        db.select(Project).where(
            Project.id == project_id,
            Project.user_id == user_id,
            Project.device_id == device.id,
        )
    )


def device_conversation(
    user_id: UUID, device: DeviceContext, conversation_id: UUID
) -> Conversation | None:
    return db.session.scalar(
        db.select(Conversation)
        .join(Project)
        .where(
            Conversation.id == conversation_id,
            Project.user_id == user_id,
            Project.device_id == device.id,
        )
    )


def device_run(user_id: UUID, device: DeviceContext, run_id: UUID) -> AgentRun | None:
    return db.session.scalar(
        db.select(AgentRun)
        .join(Conversation, AgentRun.conversation_id == Conversation.id)
        .join(Project, Conversation.project_id == Project.id)
        .where(
            AgentRun.id == run_id,
            Project.user_id == user_id,
            Project.device_id == device.id,
        )
    )
