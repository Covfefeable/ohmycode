import json
from uuid import UUID

from flask import Blueprint, Response, jsonify, request, stream_with_context
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..services.agent import prepare_completion, stream_completion
from ..services.conversations import (
    add_message,
    create_conversation,
    delete_conversation,
    edit_last_user_message,
    get_conversation,
)
from ..services.projects import create_project, delete_project, list_projects, serialize_project
from ..services.projects.serializers import serialize_conversation, serialize_message

projects_bp = Blueprint("projects", __name__)


def user_id() -> UUID:
    return UUID(get_jwt_identity())


@projects_bp.get("")
@jwt_required()
def list_projects_route():
    return jsonify([serialize_project(project) for project in list_projects(user_id())])


@projects_bp.post("")
@jwt_required()
def create_project_route():
    return jsonify(
        serialize_project(create_project(user_id(), request.get_json(silent=True) or {}))
    ), 201


@projects_bp.delete("/<uuid:project_id>")
@jwt_required()
def delete_project_route(project_id: UUID):
    delete_project(user_id(), project_id)
    return "", 204


@projects_bp.post("/<uuid:project_id>/conversations")
@jwt_required()
def create_conversation_route(project_id: UUID):
    conversation = create_conversation(user_id(), project_id, request.get_json(silent=True) or {})
    return jsonify(serialize_conversation(conversation)), 201


@projects_bp.get("/conversations/<uuid:conversation_id>")
@jwt_required()
def get_conversation_route(conversation_id: UUID):
    return jsonify(serialize_conversation(get_conversation(user_id(), conversation_id), True))


@projects_bp.delete("/conversations/<uuid:conversation_id>")
@jwt_required()
def delete_conversation_route(conversation_id: UUID):
    delete_conversation(user_id(), conversation_id)
    return "", 204


@projects_bp.post("/conversations/<uuid:conversation_id>/messages")
@jwt_required()
def add_message_route(conversation_id: UUID):
    message = add_message(user_id(), conversation_id, request.get_json(silent=True) or {})
    return jsonify(serialize_message(message)), 201


@projects_bp.patch("/conversations/<uuid:conversation_id>/messages/<uuid:message_id>")
@jwt_required()
def edit_message_route(conversation_id: UUID, message_id: UUID):
    content = str((request.get_json(silent=True) or {}).get("content") or "")
    conversation = edit_last_user_message(user_id(), conversation_id, message_id, content)
    return jsonify(serialize_conversation(conversation, True))


@projects_bp.post("/conversations/<uuid:conversation_id>/stream")
@jwt_required()
def stream_completion_route(conversation_id: UUID):
    payload = request.get_json(silent=True) or {}
    prepared = prepare_completion(
        user_id(),
        conversation_id,
        str(payload.get("content") or ""),
        payload.get("modelId"),
        payload.get("editMessageId"),
    )

    @stream_with_context
    def events():
        yield f"data: {json.dumps({'type': 'run.started', 'runId': str(prepared.run_id)})}\n\n"
        for event in stream_completion(prepared):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return Response(
        events(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
