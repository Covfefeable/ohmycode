import threading
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from app.extensions import db
from app.models import AgentEvent, AgentRun, Message, ModelExecution, ModelStreamEvent
from app.services.agent.execution_worker import execute_execution
from app.services.agent.executions import resume_execution, start_execution
from app.services.agent.runs import append_event, cancel_run

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "inspect",
            "description": "Inspect",
            "parameters": {"type": "object", "properties": {}},
        },
    }
]


def concurrent(app, operation):
    gate = threading.Barrier(2)

    def invoke():
        with app.app_context():
            gate.wait(timeout=5)
            return operation()

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(invoke) for _ in range(2)]
        return [future.result(timeout=15) for future in futures]


def submit(w, turn_id=None):
    return start_execution(
        w.user, w.conversation, "Inspect", w.model, turn_id=turn_id, tool_snapshot=TOOLS
    )


def test_concurrent_turn_submission_is_one_message_and_one_execution(workspace):
    w = workspace
    turn_id = uuid4()
    results = concurrent(w.app, lambda: submit(w, turn_id))
    assert results[0] == results[1]
    with w.app.app_context():
        assert db.session.scalar(db.select(db.func.count(Message.id))) == 1
        assert db.session.scalar(db.select(db.func.count(ModelExecution.id))) == 1
    assert w.queued == [results[0]]


def test_concurrent_tool_ack_creates_one_output_and_one_next_step(workspace):
    w = workspace
    with w.app.app_context():
        execution_id = submit(w)
        run_id = db.session.get(ModelExecution, execution_id).run_id
        run = db.session.get(AgentRun, run_id)
        append_event(run, "tool.requested", {"toolCalls": [{"id": "call-1"}]})
        run.status = "waiting_tool"
        db.session.commit()
    results = concurrent(
        w.app,
        lambda: resume_execution(
            w.user, run_id, [{"callId": "call-1", "result": "ok"}], tool_snapshot=TOOLS
        ),
    )
    assert results[0] == results[1]
    with w.app.app_context():
        assert (
            db.session.scalar(
                db.select(db.func.count(AgentEvent.id)).where(
                    AgentEvent.run_id == run_id, AgentEvent.event_type == "tool.output"
                )
            )
            == 1
        )
        assert db.session.scalar(db.select(db.func.count(ModelExecution.id))) == 2


def test_two_workers_cannot_execute_the_same_request(workspace, monkeypatch):
    w = workspace
    calls = []

    def provider(prepared):
        calls.append(prepared.run_id)
        yield {"choices": [{"delta": {"content": "Done"}}]}

    monkeypatch.setattr("app.services.agent.chat.provider_payloads", provider)
    with w.app.app_context():
        execution_id = submit(w)
    concurrent(w.app, lambda: execute_execution(execution_id))
    assert len(calls) == 1
    with w.app.app_context():
        assert (
            db.session.scalar(
                db.select(db.func.count(Message.id)).where(Message.role == "assistant")
            )
            == 1
        )
        assert db.session.get(ModelExecution, execution_id).status == "completed"


def test_cancel_fences_worker_and_sequences_remain_unique(workspace, monkeypatch):
    w = workspace
    entered, release = threading.Event(), threading.Event()

    def provider(prepared):
        yield {"choices": [{"delta": {"content": "Before"}}]}
        entered.set()
        assert release.wait(5)
        yield {"choices": [{"delta": {"content": "After"}}]}

    monkeypatch.setattr("app.services.agent.chat.provider_payloads", provider)
    with w.app.app_context():
        execution_id = submit(w)
        run_id = db.session.get(ModelExecution, execution_id).run_id

    def work():
        with w.app.app_context():
            execute_execution(execution_id)

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(work)
        try:
            assert entered.wait(5)
            with w.app.app_context():
                cancel_run(w.user, run_id, {"content": "Before"})
        finally:
            release.set()
        future.result(timeout=10)
    with w.app.app_context():
        run = db.session.get(AgentRun, run_id)
        assert run.status == "cancelled"
        assert [event.sequence for event in run.events] == list(
            range(1, run.last_event_sequence + 1)
        )
        assert (
            db.session.scalar(db.select(Message).where(Message.role == "assistant")).content
            == "Before"
        )


def test_database_cascades_execution_and_stream_deletion(workspace):
    w = workspace
    with w.app.app_context():
        execution_id = submit(w)
        run_id = db.session.get(ModelExecution, execution_id).run_id
        db.session.execute(db.delete(AgentRun).where(AgentRun.id == run_id))
        db.session.commit()
        assert db.session.get(ModelExecution, execution_id) is None
        assert list(db.session.scalars(db.select(ModelStreamEvent))) == []
