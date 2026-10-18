"""Serialize durable result-reference writes with history cleanup."""

import re
from uuid import UUID

from sqlalchemy import event, exists, func, inspect, select
from sqlalchemy.orm import Session

from ...models import (
    AgentEvent,
    AgentRun,
    AgentRunSummary,
    ContextCheckpoint,
    Message,
    ModelExecution,
    ModelStreamEvent,
    MultiAgentMessage,
    MultiAgentNode,
)
from ..errors import ServiceError

REFERENCE_MODELS = (
    AgentEvent,
    AgentRunSummary,
    ContextCheckpoint,
    Message,
    ModelExecution,
    ModelStreamEvent,
    MultiAgentMessage,
    MultiAgentNode,
)
RESULT_REFERENCE = re.compile(
    r'"resultRef"\s*:\s*\{[^}]*"runId"\s*:\s*'
    r'"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"'
)


def referenced_runs(value: object) -> set[UUID]:
    if isinstance(value, str):
        return {UUID(match) for match in RESULT_REFERENCE.findall(value)}
    if isinstance(value, list):
        return set().union(*(referenced_runs(item) for item in value))
    if not isinstance(value, dict):
        return set()
    result = set()
    reference = value.get("resultRef")
    if isinstance(reference, dict) and isinstance(reference.get("runId"), str):
        try:
            result.add(UUID(reference["runId"]))
        except ValueError:
            pass
    for item in value.values():
        result.update(referenced_runs(item))
    return result


def lock_result_history(session: Session, run_id: UUID, *, shared: bool = False) -> None:
    if session.get_bind().dialect.name == "postgresql":
        key = int.from_bytes(run_id.bytes[:8], "big", signed=True)
        lock = func.pg_advisory_xact_lock_shared if shared else func.pg_advisory_xact_lock
        session.execute(select(lock(key)))


@event.listens_for(Session, "before_flush")
def protect_result_references(session: Session, _context, _instances) -> None:
    references: set[UUID] = set()
    pending_histories = {
        item.run_id or (item.run.id if item.run else None)
        for item in session.new
        if isinstance(item, AgentEvent)
    }
    for item in session.new.union(session.dirty):
        if not isinstance(item, REFERENCE_MODELS):
            continue
        state = inspect(item)
        for column in state.mapper.column_attrs:
            if state.pending or state.attrs[column.key].history.has_changes():
                references.update(referenced_runs(getattr(item, column.key)))
    for run_id in sorted(references):
        lock_result_history(session, run_id, shared=True)
        run = session.get(AgentRun, run_id)
        if (
            run
            and run.status == "completed"
            and run_id not in pending_histories
            and not session.scalar(select(exists().where(AgentEvent.run_id == run_id)))
        ):
            raise ServiceError("tool_result_expired", 409)
