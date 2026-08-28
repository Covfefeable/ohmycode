import hashlib
import json
from uuid import UUID

from flask import current_app

from ...extensions import db
from ...models import AgentRun, AgentRunSummary, ModelConfiguration
from .context import _summary_request
from .prompts import TURN_SUMMARY_INSTRUCTIONS

TURN_SUMMARY_SOURCE_BYTES = 32 * 1024
RECENT_FULL_TURNS = 2


def serialized_run_events(run: AgentRun) -> str:
    return json.dumps(
        [
            {
                "sequence": event.sequence,
                "type": event.event_type,
                "payload": event.payload,
            }
            for event in run.events
        ],
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def event_source(run: AgentRun) -> tuple[str, str, int]:
    rendered = serialized_run_events(run)
    encoded = rendered.encode("utf-8")
    return rendered, hashlib.sha256(encoded).hexdigest(), len(encoded)


def enqueue_turn_summaries(conversation_id: UUID) -> list[UUID]:
    completed_runs = list(
        db.session.scalars(
            db.select(AgentRun)
            .where(
                AgentRun.conversation_id == conversation_id,
                AgentRun.status == "completed",
            )
            .order_by(AgentRun.completed_at.desc(), AgentRun.id.desc())
        )
    )
    queued: list[UUID] = []
    for run in completed_runs[RECENT_FULL_TURNS:]:
        summary = run.summary
        if summary and summary.status in {"skipped", "pending", "running", "completed"}:
            continue
        _rendered, digest, source_size = event_source(run)
        if source_size < TURN_SUMMARY_SOURCE_BYTES:
            if summary is None:
                summary = AgentRunSummary(run=run, conversation_id=conversation_id)
                db.session.add(summary)
            summary.status = "skipped"
            summary.source_last_sequence = run.last_event_sequence
            summary.source_digest = digest
            summary.source_size = source_size
            summary.summary = None
            summary.error = None
            continue
        if summary is None:
            summary = AgentRunSummary(run=run, conversation_id=conversation_id)
            db.session.add(summary)
        summary.status = "pending"
        summary.source_last_sequence = run.last_event_sequence
        summary.source_digest = digest
        summary.source_size = source_size
        summary.summary = None
        summary.error = None
        queued.append(run.id)
    db.session.commit()
    if current_app.config.get("TESTING"):
        return queued
    for run_id in queued:
        try:
            current_app.extensions["celery"].send_task(
                "app.tasks.turn_summary.summarize_agent_run",
                args=[str(run_id)],
            )
        except Exception:
            summary = db.session.scalar(
                db.select(AgentRunSummary).where(AgentRunSummary.run_id == run_id)
            )
            if summary:
                summary.status = "failed"
                summary.error = "enqueue_failed"
                db.session.commit()
            current_app.logger.warning("Turn summary enqueue failed", exc_info=True)
    return queued


def summarize_agent_run(run_id: UUID) -> bool:
    summary = db.session.scalar(
        db.select(AgentRunSummary).where(AgentRunSummary.run_id == run_id).with_for_update()
    )
    if not summary or summary.status == "completed":
        return False
    run = db.session.get(AgentRun, run_id)
    if not run:
        return False
    rendered, digest, source_size = event_source(run)
    if digest != summary.source_digest or run.last_event_sequence != summary.source_last_sequence:
        summary.status = "pending"
        summary.source_digest = digest
        summary.source_size = source_size
        summary.source_last_sequence = run.last_event_sequence
        db.session.commit()
        return False
    model = db.session.get(ModelConfiguration, run.model_configuration_id)
    if not model:
        summary.status = "failed"
        summary.error = "model_not_configured"
        db.session.commit()
        return False
    summary.status = "running"
    db.session.commit()
    try:
        result = _summary_request(model, rendered, TURN_SUMMARY_INSTRUCTIONS)
    except Exception as error:
        db.session.rollback()
        summary = db.session.get(AgentRunSummary, summary.id)
        summary.status = "failed"
        summary.error = type(error).__name__
        db.session.commit()
        raise
    db.session.refresh(run)
    _latest, latest_digest, _latest_size = event_source(run)
    if latest_digest != digest or run.last_event_sequence != summary.source_last_sequence:
        summary.status = "pending"
        db.session.commit()
        return False
    summary.summary = result
    summary.status = "completed"
    summary.error = None
    db.session.commit()
    return True
