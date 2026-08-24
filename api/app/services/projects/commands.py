from uuid import UUID

from ...extensions import db
from ...models import Project
from ..errors import ServiceError
from .queries import owned_project


def list_projects(user_id: UUID) -> list[Project]:
    return list(
        db.session.scalars(
            db.select(Project).where(Project.user_id == user_id).order_by(Project.created_at)
        )
    )


def create_project(user_id: UUID, payload: dict) -> Project:
    project_path = str(payload.get("path") or "").strip()[:1024]
    name = str(payload.get("name") or "").strip()[:255]
    if not project_path or not name:
        raise ServiceError("validation_error", 422)
    existing = db.session.scalar(
        db.select(Project).where(Project.user_id == user_id, Project.path == project_path)
    )
    if existing:
        raise ServiceError("project_exists", 409)
    project = Project(user_id=user_id, name=name, path=project_path)
    db.session.add(project)
    db.session.commit()
    return project


def delete_project(user_id: UUID, project_id: UUID) -> None:
    project = owned_project(user_id, project_id)
    if not project:
        raise ServiceError("not_found", 404)
    db.session.delete(project)
    db.session.commit()
