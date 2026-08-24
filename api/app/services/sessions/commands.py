from ...extensions import db
from ...models import AgentSession


def serialize_session(session: AgentSession) -> dict[str, str | None]:
    return {
        "id": str(session.id),
        "title": session.title,
        "workspacePath": session.workspace_path,
        "status": session.status,
        "createdAt": session.created_at.isoformat() if session.created_at else None,
    }


def list_sessions() -> list[AgentSession]:
    return list(
        db.session.scalars(
            db.select(AgentSession).order_by(AgentSession.updated_at.desc()).limit(50)
        )
    )


def create_session(payload: dict) -> AgentSession:
    session = AgentSession(
        title=str(payload.get("title") or "New task")[:200],
        workspace_path=payload.get("workspacePath"),
    )
    db.session.add(session)
    db.session.commit()
    return session
