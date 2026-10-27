from collections.abc import Callable, Generator

from flask import current_app

from ...extensions import db
from ...models import AgentRun
from ..errors import ServiceError
from .completion_finalization import (
    finish_completion_answer,
    record_completion_usage,
    request_completion_tools,
)
from .preparation import CompletionPreparation
from .provider_completion import CompletionAccumulator
from .provider_errors import provider_error_code
from .provider_stream import PreparedCompletion, provider_payloads
from .runs import fail_run


def stream_completion(
    prepared: PreparedCompletion | CompletionPreparation,
    *,
    is_active: Callable[[], bool] | None = None,
):
    if is_active is not None and not is_active():
        return
    if isinstance(prepared, Generator):
        try:
            prepared = yield from prepared
        except ServiceError as error:
            yield {"type": "run.failed", "errorCode": error.code}
            return
    if is_active is not None and not is_active():
        return
    completion = CompletionAccumulator()
    run = db.session.get(AgentRun, prepared.run_id)
    try:
        for payload in provider_payloads(prepared):
            if is_active is not None and not is_active():
                return
            yield from completion.consume(payload, f"reasoning-{run.last_event_sequence + 1}")
        run = db.session.scalar(
            db.select(AgentRun)
            .where(AgentRun.id == prepared.run_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if is_active is not None and not is_active():
            return
        if run.status != "running":
            return
        yield from record_completion_usage(run, prepared, completion)
        if completion.tool_calls:
            yield from request_completion_tools(run, prepared, completion)
        elif completion.answer:
            yield from finish_completion_answer(run, prepared, completion)
        else:
            fail_run(run, "empty_model_response")
            yield {"type": "run.failed", "errorCode": "empty_model_response"}
    except Exception as error:
        db.session.rollback()
        run = db.session.get(AgentRun, prepared.run_id)
        if run:
            db.session.expire(run)
        error_code = provider_error_code(error)
        if run and run.status == "running":
            fail_run(run, error_code)
        current_app.logger.exception("Agent stream failed for run %s", prepared.run_id)
        # An exception escaping a streaming response makes Werkzeug close the
        # chunked HTTP body without its terminating chunk. Electron/undici then
        # reports an opaque `Invalid EOF state` instead of the actual run error.
        # Always finish the SSE protocol normally and keep the diagnostic in
        # the server log.
        yield {"type": "run.failed", "errorCode": error_code}
        return
