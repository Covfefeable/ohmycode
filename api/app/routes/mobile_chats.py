import json
from uuid import UUID

from flask import Blueprint, Response, jsonify, request, stream_with_context
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..services.agent import stream_completion
from ..services.agent.provider_stream import PreparedCompletion
from ..services.agent.tool_results import read_tool_result, search_tool_result
from ..services.errors import ServiceError
from ..services.mobile_chats import (
    cancel_mobile_run,
    create_mobile_conversation,
    delete_mobile_conversation,
    get_mobile_conversation,
    get_owned_mobile_run,
    list_mobile_conversations,
    recover_mobile_run,
    resume_mobile_run,
    stream_mobile_chat,
)
from ..services.projects.serializers import serialize_conversation

mobile_chats_bp = Blueprint("mobile_chats", __name__)


def user_id() -> UUID:
    return UUID(get_jwt_identity())


def stream_prepared(prepared: PreparedCompletion | list[dict]):
    @stream_with_context
    def events():
        source = (
            stream_completion(prepared)
            if isinstance(prepared, PreparedCompletion)
            else prepared
        )
        try:
            for event in source:
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except ServiceError as error:
            yield f"data: {json.dumps({'type': 'run.failed', 'errorCode': error.code})}\n\n"
        yield "data: [DONE]\n\n"

    return Response(
        events(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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


@mobile_chats_bp.post("/runs/<uuid:run_id>/resume")
@jwt_required()
def resume_mobile_run_route(run_id: UUID):
    payload = request.get_json(silent=True) or {}
    results = payload.get("results") if isinstance(payload.get("results"), list) else []
    return stream_prepared(resume_mobile_run(user_id(), run_id, results))


@mobile_chats_bp.post("/runs/<uuid:run_id>/recover")
@jwt_required()
def recover_mobile_run_route(run_id: UUID):
    payload = request.get_json(silent=True) or {}
    results = payload.get("results") if isinstance(payload.get("results"), list) else []
    return stream_prepared(recover_mobile_run(
        user_id(),
        run_id,
        str(payload.get("partialContent") or ""),
        str(payload.get("partialReasoning") or ""),
        results,
    ))


@mobile_chats_bp.post("/runs/<uuid:run_id>/tool-results/<call_id>/read")
@jwt_required()
def read_mobile_tool_result_route(run_id: UUID, call_id: str):
    identity = user_id()
    get_owned_mobile_run(identity, run_id)
    payload = request.get_json(silent=True) or {}
    return read_tool_result(
        identity,
        run_id,
        call_id,
        payload.get("cursor"),
        payload.get("maxTokens"),
    )


@mobile_chats_bp.post("/runs/<uuid:run_id>/tool-results/<call_id>/search")
@jwt_required()
def search_mobile_tool_result_route(run_id: UUID, call_id: str):
    identity = user_id()
    get_owned_mobile_run(identity, run_id)
    payload = request.get_json(silent=True) or {}
    return search_tool_result(
        identity,
        run_id,
        call_id,
        str(payload.get("query") or ""),
        payload.get("maxMatches"),
    )


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
