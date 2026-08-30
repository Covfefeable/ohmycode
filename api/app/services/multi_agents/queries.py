from uuid import UUID

from ...extensions import db
from ...models import MultiAgent, MultiAgentMessage, MultiAgentNode, MultiAgentTask, Project
from ..devices import DeviceContext


def list_agents(user_id: UUID) -> list[MultiAgent]:
    return list(
        db.session.scalars(
            db.select(MultiAgent)
            .where(MultiAgent.user_id == user_id)
            .order_by(MultiAgent.created_at)
        )
    )


def owned_agent(user_id: UUID, agent_id: UUID) -> MultiAgent | None:
    return db.session.scalar(
        db.select(MultiAgent).where(MultiAgent.id == agent_id, MultiAgent.user_id == user_id)
    )


def get_task(user_id: UUID, task_id: UUID) -> MultiAgentTask | None:
    return db.session.scalar(
        db.select(MultiAgentTask)
        .join(MultiAgent)
        .where(MultiAgentTask.id == task_id, MultiAgent.user_id == user_id)
    )


def owned_node(user_id: UUID, node_id: UUID) -> MultiAgentNode | None:
    return db.session.scalar(
        db.select(MultiAgentNode)
        .join(MultiAgentTask)
        .join(MultiAgent)
        .where(MultiAgentNode.id == node_id, MultiAgent.user_id == user_id)
    )


def owned_message(user_id: UUID, message_id: UUID) -> MultiAgentMessage | None:
    return db.session.scalar(
        db.select(MultiAgentMessage)
        .join(MultiAgentTask)
        .join(MultiAgent)
        .where(MultiAgentMessage.id == message_id, MultiAgent.user_id == user_id)
    )


def device_task(user_id: UUID, device: DeviceContext, task_id: UUID) -> MultiAgentTask | None:
    return db.session.scalar(
        db.select(MultiAgentTask)
        .join(MultiAgent)
        .join(Project, MultiAgentTask.project_id == Project.id)
        .where(
            MultiAgentTask.id == task_id,
            MultiAgent.user_id == user_id,
            Project.device_id == device.id,
        )
    )


def device_node(user_id: UUID, device: DeviceContext, node_id: UUID) -> MultiAgentNode | None:
    return db.session.scalar(
        db.select(MultiAgentNode)
        .join(MultiAgentTask)
        .join(MultiAgent)
        .join(Project, MultiAgentTask.project_id == Project.id)
        .where(
            MultiAgentNode.id == node_id,
            MultiAgent.user_id == user_id,
            Project.device_id == device.id,
        )
    )
