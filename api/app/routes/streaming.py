from uuid import UUID

from flask import Response, stream_with_context

from ..services.agent.executions import subscribe_execution


def execution_response(execution_id: UUID) -> Response:
    return Response(
        stream_with_context(subscribe_execution(execution_id)),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
