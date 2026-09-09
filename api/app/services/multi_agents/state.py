from uuid import UUID

from ...extensions import db
from ...models import AgentRun, MultiAgentMessage, MultiAgentNode, MultiAgentTask
from ..errors import ServiceError


def host_for(task: MultiAgentTask) -> MultiAgentNode:
    host = next((node for node in task.members if node.is_host), None)
    if not host:
        raise ServiceError("collaboration_host_missing", 409)
    return host


def clear_queue(task: MultiAgentTask) -> None:
    task.execution_queue = []
    for node in task.members:
        if node.status == "queued":
            node.status = "idle"


def enqueue(task: MultiAgentTask, node: MultiAgentNode) -> None:
    node_id = str(node.id)
    queue = list(task.execution_queue or [])
    if node.status != "ready" and node_id not in queue:
        queue.append(node_id)
        task.execution_queue = queue
    if node.status == "idle":
        node.status = "queued"


def enqueue_front(task: MultiAgentTask, node: MultiAgentNode) -> None:
    node_id = str(node.id)
    remaining = [item for item in task.execution_queue or [] if item != node_id]
    task.execution_queue = [node_id, *remaining]
    if node.status == "idle":
        node.status = "queued"


def activate_next(task: MultiAgentTask, fallback: MultiAgentNode | None = None) -> None:
    if any(node.status in {"ready", "running"} for node in task.members):
        return
    members = {str(node.id): node for node in task.members}
    queue = list(task.execution_queue or [])
    while queue:
        node = members.get(queue.pop(0))
        if node:
            task.execution_queue = queue
            node.status = "ready"
            return
    task.execution_queue = []
    (fallback or host_for(task)).status = "ready"


def next_message_sequence(task_id: UUID) -> int:
    db.session.execute(
        db.select(MultiAgentTask.id).where(MultiAgentTask.id == task_id).with_for_update()
    )
    current = db.session.scalar(
        db.select(db.func.max(MultiAgentMessage.sequence)).where(
            MultiAgentMessage.task_id == task_id
        )
    )
    return (current or 0) + 1


def current_run(node: MultiAgentNode) -> AgentRun | None:
    return db.session.scalar(
        db.select(AgentRun)
        .where(AgentRun.conversation_id == node.conversation_id)
        .order_by(AgentRun.started_at.desc())
        .limit(1)
    )
