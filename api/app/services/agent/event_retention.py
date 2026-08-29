from datetime import UTC, datetime, timedelta
from uuid import UUID

from flask import current_app
from sqlalchemy import String, and_, cast, exists, or_

from ...extensions import db
from ...models import (
    AgentEvent,
    AgentRun,
    AgentRunSummary,
    ContextCheckpoint,
    Message,
    MultiAgentMessage,
    MultiAgentNode,
)

DEFAULT_BATCH_SIZE = 100


def _contains_reference(column, run_id: UUID):
    return cast(column, String).contains(str(run_id))


def _is_referenced(run: AgentRun) -> bool:
    """Conservatively retain a run if durable content mentions its resultRef runId."""
    references = (
        exists(
            db.select(AgentEvent.id).where(
                AgentEvent.run_id != run.id,
                _contains_reference(AgentEvent.payload, run.id),
            )
        ),
        exists(
            db.select(AgentRunSummary.id).where(
                _contains_reference(AgentRunSummary.summary, run.id)
            )
        ),
        exists(
            db.select(ContextCheckpoint.id).where(
                or_(
                    _contains_reference(ContextCheckpoint.summary, run.id),
                    _contains_reference(ContextCheckpoint.state, run.id),
                )
            )
        ),
        exists(
            db.select(Message.id).where(
                or_(
                    _contains_reference(Message.content, run.id),
                    _contains_reference(Message.reasoning, run.id),
                    _contains_reference(Message.activity, run.id),
                )
            )
        ),
        exists(
            db.select(MultiAgentNode.id).where(
                _contains_reference(MultiAgentNode.final_output, run.id)
            )
        ),
        exists(
            db.select(MultiAgentMessage.id).where(
                _contains_reference(MultiAgentMessage.content, run.id)
            )
        ),
    )
    return bool(db.session.scalar(db.select(or_(*references))))


def cleanup_expired_agent_events(
    *,
    now: datetime | None = None,
    retention_days: int | None = None,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> dict[str, int]:
    """Delete only summarized, expired and unreferenced AgentEvent histories."""
    days = max(
        90,
        retention_days
        if retention_days is not None
        else int(current_app.config["AGENT_EVENT_RETENTION_DAYS"]),
    )
    cutoff = (now or datetime.now(UTC)) - timedelta(days=days)
    page_size = max(1, min(batch_size, 1000))
    base_query = (
        db.select(AgentRun)
        .join(AgentRunSummary, AgentRunSummary.run_id == AgentRun.id)
        .where(
            AgentRun.status == "completed",
            AgentRun.completed_at < cutoff,
            AgentRunSummary.status == "completed",
            AgentRunSummary.summary.is_not(None),
            AgentRunSummary.summary != "",
            AgentRunSummary.source_last_sequence == AgentRun.last_event_sequence,
            exists(db.select(AgentEvent.id).where(AgentEvent.run_id == AgentRun.id)),
        )
    )
    candidate_count = 0
    deleted_events = 0
    retained_references = 0
    cleaned_runs = 0
    cursor: tuple[datetime, UUID] | None = None
    while cleaned_runs < page_size:
        query = base_query
        if cursor is not None:
            completed_at, run_id = cursor
            query = query.where(
                or_(
                    AgentRun.completed_at > completed_at,
                    and_(AgentRun.completed_at == completed_at, AgentRun.id > run_id),
                )
            )
        candidates = list(
            db.session.scalars(
                query.order_by(AgentRun.completed_at, AgentRun.id).limit(page_size)
            )
        )
        if not candidates:
            break
        candidate_count += len(candidates)
        for run in candidates:
            if _is_referenced(run):
                retained_references += 1
                continue
            result = db.session.execute(
                db.delete(AgentEvent).where(AgentEvent.run_id == run.id)
            )
            deleted_events += result.rowcount or 0
            cleaned_runs += 1
            if cleaned_runs >= page_size:
                break
        last = candidates[-1]
        if last.completed_at is None or len(candidates) < page_size:
            break
        cursor = (last.completed_at, last.id)
    db.session.commit()
    return {
        "candidates": candidate_count,
        "cleanedRuns": cleaned_runs,
        "deletedEvents": deleted_events,
        "retainedReferences": retained_references,
    }
