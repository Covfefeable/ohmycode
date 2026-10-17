"""One Celery job performs one model request; tools remain in the client Runtime."""

import time
from datetime import UTC, datetime, timedelta
from uuid import UUID

from flask import current_app

from ...extensions import db
from ...models import AgentRun, ModelExecution, ModelStreamEvent
from ..errors import ServiceError
from .chat import stream_completion
from .config import MODEL_REQUEST_TIMEOUT_SECONDS, MODEL_STREAM_ATTEMPTS
from .executions import dispatch_execution
from .preparation import iter_prepare_completion
from .runs import fail_run

LEASE_DURATION = timedelta(seconds=2 * MODEL_REQUEST_TIMEOUT_SECONDS * MODEL_STREAM_ATTEMPTS + 60)


def _write(execution: ModelExecution, events: list[dict]) -> None:
    for payload in events:
        execution.last_sequence += 1
        db.session.add(
            ModelStreamEvent(
                execution_id=execution.id, sequence=execution.last_sequence, payload=payload
            )
        )
    execution.lease_until = datetime.now(UTC) + LEASE_DURATION
    if execution.status not in {"queued", "running"}:
        execution.parameters = {}
    db.session.commit()


def _lock_run(run_id: UUID) -> AgentRun | None:
    return db.session.scalar(
        db.select(AgentRun)
        .where(AgentRun.id == run_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def execute_execution(execution_id: UUID) -> None:
    claimed = db.session.execute(
        db.update(ModelExecution)
        .where(ModelExecution.id == execution_id, ModelExecution.status == "queued")
        .values(status="running", lease_until=datetime.now(UTC) + LEASE_DURATION)
    ).rowcount
    db.session.commit()
    if not claimed:
        return
    execution = db.session.get(ModelExecution, execution_id)
    run_id = execution.run_id
    parameters = execution.parameters
    pending: list[dict] = []
    flushed_at = time.monotonic()
    source = None
    checked_at = 0.0
    still_active = True

    def active() -> bool:
        nonlocal checked_at, still_active
        if time.monotonic() - checked_at >= 0.25:
            with db.engine.connect() as connection:
                statuses = connection.execute(
                    db.select(AgentRun.status, ModelExecution.status)
                    .join(ModelExecution, ModelExecution.run_id == AgentRun.id)
                    .where(ModelExecution.id == execution_id)
                ).first()
            still_active = statuses == ("running", "running")
            checked_at = time.monotonic()
        return still_active

    try:
        run = _lock_run(run_id)
        if not run or run.status in {"cancelled", "completed", "failed"}:
            execution.status = "cancelled"
            db.session.commit()
            return
        db.session.commit()
        preparation = iter_prepare_completion(
            run_id,
            parameters["workspace_instructions"],
            parameters["tools"],
            parameters["system_instructions"],
        )
        source = stream_completion(preparation, is_active=active)
        for event in source:
            pending.append(event)
            # Commit the complete tool batch together with its waiting_tool transition.
            if event["type"] == "tool.requested":
                continue
            now = time.monotonic()
            if now - flushed_at >= 0.032 or event["type"] not in {
                "message.delta",
                "reasoning.delta",
            }:
                run = _lock_run(run_id)
                db.session.refresh(execution)
                if execution.status != "running" or run.status == "cancelled":
                    pending.clear()
                    break
                if event["type"] == "run.failed":
                    execution.status = "failed"
                _write(execution, pending)
                pending.clear()
                flushed_at = now
        run = _lock_run(run_id)
        db.session.refresh(execution)
        if execution.status == "running":
            execution.status = run.status if run.status in {"cancelled", "failed"} else "completed"
            _write(execution, pending if run.status != "cancelled" else [])
            if run.status == "completed":
                from .turn_summaries import enqueue_turn_summaries

                enqueue_turn_summaries(run.conversation_id)
    except Exception as error:
        db.session.rollback()
        run = _lock_run(run_id)
        execution = db.session.get(ModelExecution, execution_id)
        if execution and execution.status == "running":
            code = error.code if isinstance(error, ServiceError) else "runtime_failed"
            if run and run.status not in {"cancelled", "completed", "failed"}:
                fail_run(run, code)
            execution.status = "failed"
            _write(execution, [*pending, {"type": "run.failed", "errorCode": code}])
        current_app.logger.exception("Model execution failed: %s", execution_id)
    finally:
        if source is not None:
            source.close()
        db.session.remove()


def reconcile_executions() -> None:
    now = datetime.now(UTC)
    queued = list(
        db.session.scalars(
            db.select(ModelExecution.id)
            .where(ModelExecution.status == "queued")
            .order_by(ModelExecution.created_at)
            .limit(100)
        )
    )
    expired = list(
        db.session.scalars(
            db.select(ModelExecution.id)
            .where(ModelExecution.status == "running", ModelExecution.lease_until < now)
            .limit(100)
        )
    )
    for execution_id in expired:
        execution = db.session.get(ModelExecution, execution_id)
        run = _lock_run(execution.run_id)
        execution = db.session.scalar(
            db.select(ModelExecution)
            .where(
                ModelExecution.id == execution_id,
                ModelExecution.status == "running",
                ModelExecution.lease_until < now,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if execution is None:
            db.session.rollback()
            continue
        if run and run.status in {"running", "waiting_tool"}:
            fail_run(run, "model_worker_lost")
        execution.status = "failed"
        _write(execution, [{"type": "run.failed", "errorCode": "model_worker_lost"}])
    for execution_id in queued:
        dispatch_execution(execution_id)
