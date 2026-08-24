import json
from uuid import UUID

from flask import Blueprint, Response, request, stream_with_context
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..services.agent import resume_completion, stream_completion
from ..services.agent.runs import cancel_run

agent_runs_bp = Blueprint("agent_runs", __name__)


@agent_runs_bp.post("/<uuid:run_id>/cancel")
@jwt_required()
def cancel_run_route(run_id: UUID):
    payload = request.get_json(silent=True) or {}
    cancel_run(UUID(get_jwt_identity()), run_id, payload.get("partialMessage"))
    return "", 204


@agent_runs_bp.post("/<uuid:run_id>/resume")
@jwt_required()
def resume_run_route(run_id: UUID):
    payload = request.get_json(silent=True) or {}
    prepared = resume_completion(
        UUID(get_jwt_identity()),
        run_id,
        payload.get("results") if isinstance(payload.get("results"), list) else [],
    )

    @stream_with_context
    def events():
        for event in stream_completion(prepared):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return Response(
        events(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
