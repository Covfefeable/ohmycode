from datetime import UTC, datetime, timedelta

from app import create_app
from app.extensions import db
from app.models import AgentEvent, AgentRun, AgentRunSummary, Conversation, Project, User
from app.services.agent.event_retention import cleanup_expired_agent_events


def _completed_run(conversation: Conversation, completed_at: datetime) -> AgentRun:
    run = AgentRun(
        conversation_id=conversation.id,
        status="completed",
        last_event_sequence=2,
        completed_at=completed_at,
    )
    db.session.add(run)
    db.session.flush()
    db.session.add_all(
        [
            AgentEvent(run=run, sequence=1, event_type="run.started", payload={}),
            AgentEvent(
                run=run,
                sequence=2,
                event_type="tool.output",
                payload={"results": [{"callId": "call-1", "result": "complete output"}]},
            ),
        ]
    )
    return run


def _summary(run: AgentRun, content: str, *, source_sequence: int = 2) -> None:
    db.session.add(
        AgentRunSummary(
            run=run,
            conversation_id=run.conversation_id,
            status="completed",
            source_last_sequence=source_sequence,
            source_digest="digest",
            source_size=100,
            summary=content,
        )
    )


def test_cleanup_only_removes_expired_summarized_unreferenced_events():
    app = create_app("testing")
    with app.app_context():
        db.create_all()
        now = datetime.now(UTC)
        user = User(email="retention@example.com", display_name="Retention", password_hash="x")
        db.session.add(user)
        db.session.flush()
        project = Project(
            user_id=user.id,
            device_id="desktop",
            device_name="Desktop",
            name="workspace",
            path="/workspace",
        )
        db.session.add(project)
        db.session.flush()
        conversation = Conversation(project_id=project.id)
        db.session.add(conversation)
        db.session.flush()

        referenced = _completed_run(conversation, now - timedelta(days=92))
        _summary(
            referenced,
            "Read the retained result with "
            f'{{"resultRef":{{"runId":"{referenced.id}","callId":"call-1"}}}}.',
        )

        removable = _completed_run(conversation, now - timedelta(days=91))
        _summary(removable, "All durable facts are summarized.")

        recent = _completed_run(conversation, now - timedelta(days=89))
        _summary(recent, "Recent summary")

        stale_summary = _completed_run(conversation, now - timedelta(days=91))
        _summary(stale_summary, "Stale summary", source_sequence=1)
        db.session.commit()

        result = cleanup_expired_agent_events(now=now, retention_days=90, batch_size=1)

        assert result == {
            "candidates": 2,
            "cleanedRuns": 1,
            "deletedEvents": 2,
            "retainedReferences": 1,
        }
        assert db.session.scalar(
            db.select(db.func.count())
            .select_from(AgentEvent)
            .where(AgentEvent.run_id == removable.id)
        ) == 0
        for run in (referenced, recent, stale_summary):
            assert db.session.scalar(
                db.select(db.func.count())
                .select_from(AgentEvent)
                .where(AgentEvent.run_id == run.id)
            ) == 2


def test_retention_period_cannot_be_configured_below_ninety_days():
    app = create_app("testing")
    with app.app_context():
        db.create_all()
        now = datetime.now(UTC)
        user = User(email="minimum@example.com", display_name="Minimum", password_hash="x")
        db.session.add(user)
        db.session.flush()
        project = Project(
            user_id=user.id,
            device_id="desktop",
            device_name="Desktop",
            name="workspace",
            path="/workspace",
        )
        db.session.add(project)
        db.session.flush()
        conversation = Conversation(project_id=project.id)
        db.session.add(conversation)
        db.session.flush()
        run = _completed_run(conversation, now - timedelta(days=30))
        _summary(run, "Summary")
        db.session.commit()

        result = cleanup_expired_agent_events(now=now, retention_days=1)

        assert result["candidates"] == 0
        assert db.session.scalar(
            db.select(db.func.count()).select_from(AgentEvent).where(AgentEvent.run_id == run.id)
        ) == 2
