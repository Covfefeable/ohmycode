from uuid import UUID

from ...extensions import db
from ...models import MultiAgentTask, WorkspaceChange
from ..errors import ServiceError
from .queries import owned_node


def record_changes(user_id: UUID, node_id: UUID, payload: dict) -> MultiAgentTask:
    node = owned_node(user_id, node_id)
    if not node:
        raise ServiceError("not_found", 404)
    changes = payload.get("changes")
    if not isinstance(changes, list):
        raise ServiceError("validation_error", 422)
    current = (
        db.session.scalar(
            db.select(db.func.max(WorkspaceChange.sequence)).where(
                WorkspaceChange.task_id == node.task_id
            )
        )
        or 0
    )
    for offset, item in enumerate(changes[:500], 1):
        if isinstance(item, dict) and str(item.get("path") or "").strip():
            db.session.add(
                WorkspaceChange(
                    task_id=node.task_id,
                    node_id=node.id,
                    sequence=current + offset,
                    path=str(item["path"])[:1024],
                    operation=str(item.get("operation") or "modified")[:32],
                    before_hash=str(item.get("beforeHash") or "")[:128] or None,
                    after_hash=str(item.get("afterHash") or "")[:128] or None,
                )
            )
    db.session.commit()
    return node.task
