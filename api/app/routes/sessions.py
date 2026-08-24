from flask import Blueprint, jsonify, request

from ..services.sessions import create_session, list_sessions, serialize_session

sessions_bp = Blueprint("sessions", __name__)


@sessions_bp.get("")
def list_sessions_route():
    return jsonify([serialize_session(item) for item in list_sessions()])


@sessions_bp.post("")
def create_session_route():
    session = create_session(request.get_json(silent=True) or {})
    return jsonify(serialize_session(session)), 201
