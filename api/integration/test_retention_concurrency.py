import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

from app.extensions import db
from app.models import AgentEvent, AgentRun, AgentRunSummary, Message
from app.services.agent import event_retention, result_references
from app.services.errors import ServiceError


def completed_run(workspace):
    with workspace.app.app_context():
        run = AgentRun(
            conversation_id=workspace.conversation,
            status="completed",
            last_event_sequence=1,
            completed_at=datetime.now(UTC) - timedelta(days=91),
        )
        db.session.add(run)
        db.session.flush()
        db.session.add_all(
            [
                AgentEvent(
                    run=run, sequence=1, event_type="tool.output", payload={"output": "kept"}
                ),
                AgentRunSummary(
                    run=run,
                    conversation_id=workspace.conversation,
                    status="completed",
                    source_last_sequence=1,
                    source_digest="digest",
                    source_size=10,
                    summary="Complete summary",
                ),
            ]
        )
        db.session.commit()
        return run.id


def add_reference(workspace, run_id):
    result_references.protect_result_references({"resultRef": {"runId": str(run_id)}})
    db.session.add(
        Message(
            conversation_id=workspace.conversation,
            role="assistant",
            content="Reference",
            activity=[{"resultRef": {"runId": str(run_id), "callId": "call"}}],
        )
    )
    db.session.flush()


def test_reference_committing_first_is_preserved(workspace, monkeypatch):
    run_id = completed_run(workspace)
    writer_ready = threading.Event()
    cleaner_ready = threading.Event()
    original_lock = result_references.lock_result_history

    def cleanup_lock(session, target_id):
        cleaner_ready.set()
        original_lock(session, target_id)

    monkeypatch.setattr(event_retention, "lock_result_history", cleanup_lock)

    def writer():
        with workspace.app.app_context():
            add_reference(workspace, run_id)
            writer_ready.set()
            assert cleaner_ready.wait(5)
            db.session.commit()

    def cleaner():
        assert writer_ready.wait(5)
        with workspace.app.app_context():
            return event_retention.cleanup_expired_agent_events()

    with ThreadPoolExecutor(max_workers=2) as pool:
        writing = pool.submit(writer)
        cleaning = pool.submit(cleaner)
        writing.result(timeout=10)
        result = cleaning.result(timeout=10)
    assert result["cleanedRuns"] == 0
    assert result["retainedReferences"] == 1


def test_cleanup_committing_first_rejects_a_dangling_reference(workspace, monkeypatch):
    run_id = completed_run(workspace)
    cleaner_ready = threading.Event()
    writer_ready = threading.Event()
    original_check = event_retention._is_referenced
    original_lock = result_references.lock_result_history

    def check(run):
        result = original_check(run)
        cleaner_ready.set()
        assert writer_ready.wait(5)
        return result

    def reference_lock(session, target_id, *, shared=False):
        writer_ready.set()
        original_lock(session, target_id, shared=shared)

    monkeypatch.setattr(event_retention, "_is_referenced", check)
    monkeypatch.setattr(result_references, "lock_result_history", reference_lock)

    def cleaner():
        with workspace.app.app_context():
            return event_retention.cleanup_expired_agent_events()

    def writer():
        assert cleaner_ready.wait(5)
        with workspace.app.app_context():
            try:
                add_reference(workspace, run_id)
                db.session.commit()
            except ServiceError as error:
                db.session.rollback()
                return error.code
        return "unexpected_success"

    with ThreadPoolExecutor(max_workers=2) as pool:
        cleaning = pool.submit(cleaner)
        writing = pool.submit(writer)
        assert cleaning.result(timeout=10)["cleanedRuns"] == 1
        assert writing.result(timeout=10) == "tool_result_expired"
