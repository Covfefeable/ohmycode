import json
from uuid import UUID

from flask import Blueprint, Response, request, stream_with_context
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..services.agent import recover_completion, resume_completion, stream_completion
from ..services.agent.provider_stream import PreparedCompletion
from ..services.agent.runs import cancel_run
from ..services.agent.tool_results import read_tool_result, search_tool_result
from ..services.errors import ServiceError
from ..services.projects.queries import device_run
from .device import current_device

agent_runs_bp = Blueprint("agent_runs", __name__)


def stream_response(prepared: PreparedCompletion | list[dict]):
    @stream_with_context
    def events():
        source = (
            stream_completion(prepared)
            if isinstance(prepared, PreparedCompletion)
            else prepared
        )
        for event in source:
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return Response(
        events(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@agent_runs_bp.post("/<uuid:run_id>/cancel")
@jwt_required()
def cancel_run_route(run_id: UUID):
    if not device_run(UUID(get_jwt_identity()), current_device(), run_id):
        raise ServiceError("not_found", 404)
    payload = request.get_json(silent=True) or {}
    cancel_run(UUID(get_jwt_identity()), run_id, payload.get("partialMessage"))
    return "", 204


@agent_runs_bp.post("/<uuid:run_id>/resume")
@jwt_required()
def resume_run_route(run_id: UUID):
    if not device_run(UUID(get_jwt_identity()), current_device(), run_id):
        raise ServiceError("not_found", 404)
    payload = request.get_json(silent=True) or {}
    prepared = resume_completion(
        UUID(get_jwt_identity()),
        run_id,
        payload.get("results") if isinstance(payload.get("results"), list) else [],
        str(payload.get("workspaceInstructions") or ""),
        payload.get("tools"),
    )

    return stream_response(prepared)


@agent_runs_bp.post("/<uuid:run_id>/recover")
@jwt_required()
def recover_run_route(run_id: UUID):
    if not device_run(UUID(get_jwt_identity()), current_device(), run_id):
        raise ServiceError("not_found", 404)
    payload = request.get_json(silent=True) or {}
    prepared = recover_completion(
        UUID(get_jwt_identity()),
        run_id,
        str(payload.get("workspaceInstructions") or ""),
        str(payload.get("partialContent") or ""),
        str(payload.get("partialReasoning") or ""),
        payload.get("results") if isinstance(payload.get("results"), list) else [],
        payload.get("tools"),
    )
    return stream_response(prepared)


@agent_runs_bp.post("/<uuid:run_id>/tool-results/<call_id>/read")
@jwt_required()
def read_tool_result_route(run_id: UUID, call_id: str):
    identity = UUID(get_jwt_identity())
    if not device_run(identity, current_device(), run_id):
        raise ServiceError("not_found", 404)
    payload = request.get_json(silent=True) or {}
    return read_tool_result(
        identity,
        run_id,
        call_id,
        payload.get("cursor"),
        payload.get("maxTokens"),
    )


@agent_runs_bp.post("/<uuid:run_id>/tool-results/<call_id>/search")
@jwt_required()
def search_tool_result_route(run_id: UUID, call_id: str):
    identity = UUID(get_jwt_identity())
    if not device_run(identity, current_device(), run_id):
        raise ServiceError("not_found", 404)
    payload = request.get_json(silent=True) or {}
    return search_tool_result(
        identity,
        run_id,
        call_id,
        str(payload.get("query") or ""),
        payload.get("maxMatches"),
    )
