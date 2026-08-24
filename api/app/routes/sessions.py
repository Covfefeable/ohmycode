from flask import Blueprint, jsonify, request

from ..extensions import db
from ..models import AgentSession

sessions_bp = Blueprint("sessions", __name__)


def serialize(session: AgentSession) -> dict[str, str | None]:
    return {
        "id": str(session.id),
        "title": session.title,
        "workspacePath": session.workspace_path,
        "status": session.status,
        "createdAt": session.created_at.isoformat() if session.created_at else None,
    }


@sessions_bp.get("")
def list_sessions():
    sessions = db.session.execute(
        db.select(AgentSession).order_by(AgentSession.updated_at.desc()).limit(50)
    ).scalars()
    return jsonify([serialize(item) for item in sessions])


@sessions_bp.post("")
def create_session():
    payload = request.get_json(silent=True) or {}
    session = AgentSession(
        title=str(payload.get("title") or "New task")[:200],
        workspace_path=payload.get("workspacePath"),
    )
    db.session.add(session)
    db.session.commit()
    return jsonify(serialize(session)), 201

