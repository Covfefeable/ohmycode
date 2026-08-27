import json
from uuid import UUID

from flask import Blueprint, Response, jsonify, request, stream_with_context
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..services.errors import ServiceError
from ..services.mobile_chats import (
    cancel_mobile_run,
    create_mobile_conversation,
    delete_mobile_conversation,
    get_mobile_conversation,
    list_mobile_conversations,
    stream_mobile_chat,
)
from ..services.projects.serializers import serialize_conversation

mobile_chats_bp = Blueprint("mobile_chats", __name__)


def user_id() -> UUID:
    return UUID(get_jwt_identity())


@mobile_chats_bp.get("")
@jwt_required()
def list_mobile_conversations_route():
    return jsonify(
        [serialize_conversation(item) for item in list_mobile_conversations(user_id())]
    )


@mobile_chats_bp.post("")
@jwt_required()
def create_mobile_conversation_route():
    conversation = create_mobile_conversation(user_id(), request.get_json(silent=True) or {})
    return jsonify(serialize_conversation(conversation, True)), 201


@mobile_chats_bp.get("/<uuid:conversation_id>")
@jwt_required()
def get_mobile_conversation_route(conversation_id: UUID):
    conversation = get_mobile_conversation(user_id(), conversation_id)
    return jsonify(serialize_conversation(conversation, True))


@mobile_chats_bp.delete("/<uuid:conversation_id>")
@jwt_required()
def delete_mobile_conversation_route(conversation_id: UUID):
    delete_mobile_conversation(user_id(), conversation_id)
    return "", 204


@mobile_chats_bp.post("/runs/<uuid:run_id>/cancel")
@jwt_required()
def cancel_mobile_run_route(run_id: UUID):
    payload = request.get_json(silent=True) or {}
    cancel_mobile_run(user_id(), run_id, str(payload.get("partialMessage") or ""))
    return "", 204


@mobile_chats_bp.post("/<uuid:conversation_id>/stream")
@jwt_required()
def stream_mobile_conversation_route(conversation_id: UUID):
    payload = request.get_json(silent=True) or {}
    try:
        turn_id = UUID(str(payload["turnId"])) if payload.get("turnId") else None
    except ValueError:
        return jsonify({"error": {"code": "invalid_turn_id"}}), 422

    @stream_with_context
    def events():
        try:
            for event in stream_mobile_chat(
                user_id(),
                conversation_id,
                str(payload.get("content") or ""),
                payload.get("modelId"),
                turn_id,
            ):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except ServiceError as error:
            yield f"data: {json.dumps({'type': 'run.failed', 'errorCode': error.code})}\n\n"
        yield "data: [DONE]\n\n"

    return Response(
        events(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
