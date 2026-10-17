from uuid import UUID

from flask import Blueprint, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..services.agent.executions import recover_execution, resume_execution
from ..services.agent.runs import cancel_run
from ..services.agent.tool_results import read_tool_result, search_tool_result
from ..services.errors import ServiceError
from ..services.projects.queries import device_run
from .device import current_device
from .streaming import execution_response

agent_runs_bp = Blueprint("agent_runs", __name__)


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
    execution_id = resume_execution(
        UUID(get_jwt_identity()),
        run_id,
        payload.get("results") if isinstance(payload.get("results"), list) else [],
        str(payload.get("workspaceInstructions") or ""),
        payload.get("tools"),
    )

    return execution_response(execution_id)


@agent_runs_bp.post("/<uuid:run_id>/recover")
@jwt_required()
def recover_run_route(run_id: UUID):
    if not device_run(UUID(get_jwt_identity()), current_device(), run_id):
        raise ServiceError("not_found", 404)
    payload = request.get_json(silent=True) or {}
    execution_id = recover_execution(
        UUID(get_jwt_identity()),
        run_id,
        str(payload.get("workspaceInstructions") or ""),
        payload.get("results") if isinstance(payload.get("results"), list) else [],
        payload.get("tools"),
    )
    return execution_response(execution_id)


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
