"""Serialize durable result-reference writes with history cleanup."""

import re
from uuid import UUID

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from ...extensions import db
from ...models import AgentEvent, AgentRun
from ..errors import ServiceError

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


def protect_result_references(*values: object) -> None:
    """Validate references explicitly before persisting their owning content."""
    with db.session.no_autoflush:
        _protect_references(set().union(*(referenced_runs(value) for value in values)))


def _protect_references(references: set[UUID]) -> None:
    for run_id in sorted(references):
        lock_result_history(db.session, run_id, shared=True)
        run = db.session.get(AgentRun, run_id)
        if (
            run
            and run.status == "completed"
            and not db.session.scalar(select(exists().where(AgentEvent.run_id == run_id)))
        ):
            raise ServiceError("tool_result_expired", 409)
