import json
import threading
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from app import create_app
from app.config import TestingConfig
from app.extensions import db
from app.models import (
    AgentRun,
    Conversation,
    Message,
    ModelConfiguration,
    ModelExecution,
    ModelStreamEvent,
    Project,
    User,
)
from app.services.agent.execution_worker import execute_execution, reconcile_executions
from app.services.agent.executions import (
    latest_execution,
    recover_execution,
    resume_execution,
    start_execution,
    subscribe_execution,
)
from app.services.agent.runs import cancel_run
from app.services.errors import ServiceError
from app.services.model_credentials import encrypt_api_key

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


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    monkeypatch.setattr(
        TestingConfig, "SQLALCHEMY_DATABASE_URI", f"sqlite:///{tmp_path / 'jobs.db'}"
    )
    app = create_app("testing")
    queued = []
    monkeypatch.setattr("app.services.agent.executions.dispatch_execution", queued.append)
    monkeypatch.setattr("app.services.agent.execution_worker.dispatch_execution", queued.append)
    with app.app_context():
        db.create_all()
        user = User(email="worker@example.com", display_name="Worker", password_hash="unused")
        db.session.add(user)
        db.session.flush()
        project = Project(
            user_id=user.id, device_id="test", device_name="Test", name="Repo", path="/repo"
        )
        db.session.add(project)
        db.session.flush()
        conversation = Conversation(project_id=project.id)
        model = ModelConfiguration(
            user_id=user.id,
            name="Test",
            base_url="https://example.com/v1",
            model="test",
            api_key_encrypted=encrypt_api_key("test-key"),
            context_length=4096,
        )
        db.session.add_all([conversation, model])
        db.session.commit()
        yield SimpleNamespace(
            app=app, user=user.id, conversation=conversation.id, model=str(model.id), queued=queued
        )


def submit(w):
    execution_id = start_execution(w.user, w.conversation, "Inspect", w.model, tool_snapshot=TOOLS)
    return execution_id, db.session.get(ModelExecution, execution_id).run_id


def text_provider(prepared):
    yield {"choices": [{"delta": {"content": "Hello "}}]}
    yield {"choices": [{"delta": {"content": "world"}}]}
    yield {"usage": {"prompt_tokens": 120, "completion_tokens": 4}}


def tool_provider(prepared):
    yield {
        "choices": [
            {
                "delta": {
                    "tool_calls": [
                        {
                            "index": 0,
                            "id": "read-1",
                            "function": {"name": "inspect", "arguments": "{}"},
                        }
                    ]
                }
            }
        ]
    }


def test_submission_does_not_call_model_and_duplicate_turn_reuses_job(workspace, monkeypatch):
    w = workspace
    monkeypatch.setattr(
        "app.services.agent.chat.provider_payloads", lambda _: pytest.fail("HTTP called model")
    )
    execution_id, run_id = submit(w)
    assert w.queued == [execution_id]
    execution = db.session.get(ModelExecution, execution_id)
    assert execution.status == "queued"
    assert "test-key" not in json.dumps(execution.parameters)
    again = start_execution(
        w.user, w.conversation, "Inspect", w.model, turn_id=run_id, tool_snapshot=TOOLS
    )
    assert again == execution_id
    assert db.session.scalar(db.select(db.func.count(Message.id))) == 1


def test_worker_output_survives_http_close_and_replays_without_second_model_request(
    workspace, monkeypatch
):
    w = workspace
    entered = threading.Event()
    release = threading.Event()
    calls = []

    def provider(prepared):
        calls.append(prepared.run_id)
        yield {"choices": [{"delta": {"content": "Hello "}}]}
        entered.set()
        assert release.wait(5)
        yield {"choices": [{"delta": {"content": "world"}}]}

    monkeypatch.setattr("app.services.agent.chat.provider_payloads", provider)
    execution_id, run_id = submit(w)

    def work():
        with w.app.app_context():
            execute_execution(execution_id)

    worker = threading.Thread(target=work)
    worker.start()
    assert entered.wait(5)
    subscription = subscribe_execution(execution_id)
    assert "run.started" in next(subscription)
    subscription.close()
    db.session.remove()
    assert db.session.get(AgentRun, run_id).status == "running"
    assert recover_execution(w.user, run_id) == execution_id
    release.set()
    worker.join(5)
    assert not worker.is_alive()
    frames = "".join(subscribe_execution(execution_id))
    assert '"content": "Hello "' in frames and '"content": "world"' in frames
    assert frames.endswith("data: [DONE]\n\n")
    assert calls == [run_id]
    assert (
        db.session.scalar(db.select(Message).where(Message.role == "assistant")).content
        == "Hello world"
    )


def test_duplicate_delivery_and_tool_ack_are_idempotent(workspace, monkeypatch):
    w = workspace
    monkeypatch.setattr("app.services.agent.chat.provider_payloads", tool_provider)
    execution_id, run_id = submit(w)
    execute_execution(execution_id)
    execute_execution(execution_id)
    assert db.session.get(AgentRun, run_id).status == "waiting_tool"
    results = [{"callId": "read-1", "result": "ok"}]
    second = resume_execution(w.user, run_id, results, tool_snapshot=TOOLS)
    assert second == recover_execution(w.user, run_id, results=results, tool_snapshot=TOOLS)
    assert w.queued == [execution_id, second]
    monkeypatch.setattr("app.services.agent.chat.provider_payloads", text_provider)
    execute_execution(second)
    assert resume_execution(w.user, run_id, results, tool_snapshot=TOOLS) == second
    assert latest_execution(run_id).id == second
    run = db.session.get(AgentRun, run_id)
    assert run.status == "completed"
    assert len([event for event in run.events if event.event_type == "tool.output"]) == 1
    assert run.input_tokens == 120 and run.output_tokens == 4


def test_unavailable_tool_is_rejected_without_failing_turn(workspace, monkeypatch):
    w = workspace

    def provider(prepared):
        payload = next(tool_provider(prepared))
        payload["choices"][0]["delta"]["tool_calls"].append(
            {
                "index": 1,
                "id": "unloaded-1",
                "function": {"name": "unloaded_mcp_tool", "arguments": "{}"},
            }
        )
        yield payload

    monkeypatch.setattr("app.services.agent.chat.provider_payloads", provider)
    execution_id, run_id = submit(w)
    execute_execution(execution_id)
    frames = "".join(subscribe_execution(execution_id))
    events = [json.loads(line[6:]) for line in frames.splitlines() if line.startswith("data: {")]
    requests = [event for event in events if event["type"] == "tool.requested"]
    assert len(requests) == 2
    assert "rejection" not in requests[0]
    rejection = requests[1]["rejection"]
    assert rejection["error"] == "unsupported_tool"
    assert "load_capability" in rejection["message"]
    assert db.session.get(AgentRun, run_id).status == "waiting_tool"
    second = resume_execution(
        w.user,
        run_id,
        [
            {"callId": "read-1", "result": "ok"},
            {"callId": "unloaded-1", "result": rejection},
        ],
        tool_snapshot=TOOLS,
    )
    monkeypatch.setattr("app.services.agent.chat.provider_payloads", text_provider)
    execute_execution(second)
    assert db.session.get(AgentRun, run_id).status == "completed"


def test_cancel_queued_job_prevents_provider_call(workspace, monkeypatch):
    w = workspace
    monkeypatch.setattr(
        "app.services.agent.chat.provider_payloads", lambda _: pytest.fail("Cancelled job ran")
    )
    execution_id, run_id = submit(w)
    cancel_run(w.user, run_id, {"content": "partial"})
    execute_execution(execution_id)
    assert db.session.get(AgentRun, run_id).status == "cancelled"
    assert "".join(subscribe_execution(execution_id)).endswith("data: [DONE]\n\n")


def test_recovery_after_cancel_does_not_reissue_pending_tools(workspace, monkeypatch):
    w = workspace
    monkeypatch.setattr("app.services.agent.chat.provider_payloads", tool_provider)
    execution_id, run_id = submit(w)
    execute_execution(execution_id)
    assert db.session.get(AgentRun, run_id).status == "waiting_tool"
    cancel_run(w.user, run_id)
    assert "".join(subscribe_execution(recover_execution(w.user, run_id))) == "data: [DONE]\n\n"


def test_cancel_running_job_cannot_be_overwritten_by_late_output(workspace, monkeypatch):
    w = workspace
    execution_id, run_id = submit(w)

    def provider(prepared):
        yield {"choices": [{"delta": {"content": "Before"}}]}
        cancel_run(w.user, run_id, {"content": "Before"})
        yield {"choices": [{"delta": {"content": "After"}}]}

    monkeypatch.setattr("app.services.agent.chat.provider_payloads", provider)
    execute_execution(execution_id)
    assert db.session.get(AgentRun, run_id).status == "cancelled"
    assert db.session.get(ModelExecution, execution_id).status == "cancelled"
    assert (
        db.session.scalar(db.select(Message).where(Message.role == "assistant")).content == "Before"
    )


def test_worker_loss_is_explicit_and_queued_jobs_are_republished(workspace):
    w = workspace
    execution_id, run_id = submit(w)
    execution = db.session.get(ModelExecution, execution_id)
    execution.status = "running"
    execution.lease_until = datetime.now(UTC) - timedelta(seconds=1)
    db.session.commit()
    reconcile_executions()
    assert db.session.get(AgentRun, run_id).error_code == "model_worker_lost"
    assert "model_worker_lost" in "".join(subscribe_execution(execution_id))
    queued_id, _ = submit(w)
    reconcile_executions()
    assert w.queued.count(queued_id) == 2


def test_resume_rejects_duplicate_result_ids_and_cross_account_access(workspace, monkeypatch):
    w = workspace
    monkeypatch.setattr("app.services.agent.chat.provider_payloads", tool_provider)
    execution_id, run_id = submit(w)
    execute_execution(execution_id)
    with pytest.raises(ServiceError, match="invalid_tool_results"):
        resume_execution(
            w.user, run_id, [{"callId": "read-1"}, {"callId": "read-1"}], tool_snapshot=TOOLS
        )
    db.session.rollback()
    other = User(email="other@example.com", display_name="Other", password_hash="unused")
    db.session.add(other)
    db.session.commit()
    with pytest.raises(ServiceError, match="not_found"):
        recover_execution(other.id, run_id)


def test_provider_failure_is_replayable_and_protocol_terminates(workspace, monkeypatch):
    w = workspace

    def provider(prepared):
        yield {"choices": [{"delta": {"content": "Partial"}}]}
        raise TimeoutError("provider timed out")

    monkeypatch.setattr("app.services.agent.chat.provider_payloads", provider)
    execution_id, run_id = submit(w)
    execute_execution(execution_id)
    frames = "".join(subscribe_execution(recover_execution(w.user, run_id)))
    assert "Partial" in frames and "TimeoutError" in frames
    assert frames.endswith("data: [DONE]\n\n")
    sequences = list(
        db.session.scalars(
            db.select(ModelStreamEvent.sequence)
            .where(ModelStreamEvent.execution_id == execution_id)
            .order_by(ModelStreamEvent.sequence)
        )
    )
    assert sequences == list(range(1, len(sequences) + 1))


@pytest.mark.parametrize("provider", [text_provider, tool_provider])
def test_crash_before_final_commit_keeps_state_and_stream_atomic(workspace, monkeypatch, provider):
    from app.services.agent import execution_worker

    w = workspace
    execution_id, run_id = submit(w)
    monkeypatch.setattr("app.services.agent.chat.provider_payloads", provider)
    original_write = execution_worker._write

    def crash_on_finish(execution, events):
        if execution.status == "completed":
            raise KeyboardInterrupt("simulate worker process loss before commit")
        original_write(execution, events)

    monkeypatch.setattr(execution_worker, "_write", crash_on_finish)
    with pytest.raises(KeyboardInterrupt):
        execute_execution(execution_id)
    assert db.session.get(AgentRun, run_id).status == "running"
    assert db.session.scalar(db.select(Message).where(Message.role == "assistant")) is None
    assert not db.session.scalar(
        db.select(ModelStreamEvent).where(
            ModelStreamEvent.execution_id == execution_id,
            ModelStreamEvent.payload["type"].as_string() == "tool.requested",
        )
    )
    execution = db.session.get(ModelExecution, execution_id)
    execution.lease_until = datetime.now(UTC) - timedelta(seconds=1)
    db.session.commit()
    reconcile_executions()
    assert db.session.get(AgentRun, run_id).error_code == "model_worker_lost"


def test_failed_submission_does_not_leave_a_user_message_or_run(workspace):
    w = workspace
    with pytest.raises(ServiceError, match="model_not_configured"):
        start_execution(w.user, w.conversation, "Hi", "missing", tool_snapshot=TOOLS)
    db.session.rollback()
    assert db.session.scalar(db.select(db.func.count(Message.id))) == 0
    assert db.session.scalar(db.select(db.func.count(AgentRun.id))) == 0


def test_steering_at_final_boundary_continues_same_run_once(workspace, monkeypatch):
    from uuid import uuid4

    from app.services.agent.executions import continue_execution
    from app.services.agent.steering import queue_input

    w = workspace
    execution_id, run_id = submit(w)
    input_id = uuid4()

    def first(prepared):
        yield {"choices": [{"delta": {"content": "Initial analysis"}}]}
        queue_input(w.user, run_id, input_id, "Only analyze, do not edit", [])
        queue_input(w.user, run_id, input_id, "Only analyze, do not edit", [])

    monkeypatch.setattr("app.services.agent.chat.provider_payloads", first)
    execute_execution(execution_id)
    run = db.session.get(AgentRun, run_id)
    assert run.status == "running"
    assert not db.session.scalar(db.select(Message).where(Message.role == "assistant"))
    assert '"type": "run.continue"' in "".join(subscribe_execution(execution_id))
    next_id = continue_execution(w.user, run_id, execution_id, "", TOOLS)
    assert continue_execution(w.user, run_id, execution_id, "", TOOLS) == next_id
    captured = []

    def second(prepared):
        captured.extend(prepared.payload["messages"])
        yield {"choices": [{"delta": {"content": "Analysis only"}}]}

    monkeypatch.setattr("app.services.agent.chat.provider_payloads", second)
    execute_execution(next_id)
    assert db.session.get(AgentRun, run_id).status == "completed"
    guidance = [item for item in captured if item.get("content") == "Only analyze, do not edit"]
    assert guidance == [{"role": "user", "content": "Only analyze, do not edit"}]
    assert any(item.get("content") == "Initial analysis" for item in captured)
    assert (
        db.session.scalar(db.select(db.func.count(Message.id)).where(Message.role == "user")) == 2
    )
    assert '"type": "input.received"' in "".join(subscribe_execution(next_id))


def test_steering_after_tools_keeps_tool_results_before_user_input(workspace, monkeypatch):
    from uuid import uuid4

    from app.services.agent.steering import queue_input

    w = workspace
    execution_id, run_id = submit(w)
    monkeypatch.setattr("app.services.agent.chat.provider_payloads", tool_provider)
    execute_execution(execution_id)
    queue_input(w.user, run_id, uuid4(), "Use this new requirement", [])
    next_id = resume_execution(
        w.user, run_id, [{"callId": "read-1", "result": "file content"}], tool_snapshot=TOOLS
    )
    captured = []

    def provider(prepared):
        captured.extend(prepared.payload["messages"])
        yield {"choices": [{"delta": {"content": "Done"}}]}

    monkeypatch.setattr("app.services.agent.chat.provider_payloads", provider)
    execute_execution(next_id)
    tool_index = next(index for index, item in enumerate(captured) if item["role"] == "tool")
    guidance_index = next(
        index
        for index, item in enumerate(captured)
        if item.get("content") == "Use this new requirement"
    )
    assert captured[tool_index - 1]["tool_calls"][0]["id"] == "read-1"
    assert guidance_index > tool_index


def test_finished_and_foreign_runs_reject_steering(workspace, monkeypatch):
    from uuid import uuid4

    from app.services.agent.steering import queue_input

    w = workspace
    execution_id, run_id = submit(w)
    with pytest.raises(ServiceError, match="not_found"):
        queue_input(uuid4(), run_id, uuid4(), "Foreign", [])
    db.session.rollback()
    monkeypatch.setattr("app.services.agent.chat.provider_payloads", text_provider)
    execute_execution(execution_id)
    with pytest.raises(ServiceError, match="turn_finished"):
        queue_input(w.user, run_id, uuid4(), "Too late", [])


def test_stopped_run_does_not_receive_pending_guidance(workspace, monkeypatch):
    from uuid import uuid4

    from app.services.agent.steering import queue_input

    w = workspace
    execution_id, run_id = submit(w)
    queue_input(w.user, run_id, uuid4(), "Pending guidance", [])
    cancel_run(w.user, run_id)
    monkeypatch.setattr(
        "app.services.agent.chat.provider_payloads",
        lambda _: pytest.fail("Cancelled run called provider"),
    )
    execute_execution(execution_id)
    assert (
        db.session.scalar(db.select(db.func.count(Message.id)).where(Message.role == "user")) == 1
    )


def test_guidance_endpoint_checks_device_and_persists_delivery_status(workspace, monkeypatch):
    from uuid import uuid4

    from flask_jwt_extended import create_access_token

    w = workspace
    execution_id, run_id = submit(w)
    input_id = uuid4()
    token = create_access_token(identity=str(w.user))
    headers = {
        "Authorization": f"Bearer {token}",
        "X-OhMyCode-Device-Id": "test",
        "X-OhMyCode-Device-Name": "Test",
    }
    url = f"/api/agent-runs/{run_id}/inputs/{input_id}"
    client = w.app.test_client()
    assert (
        client.post(
            url,
            json={"content": "New requirement"},
            headers={**headers, "X-OhMyCode-Device-Id": "other"},
        ).status_code
        == 404
    )
    assert client.post(url, json={"content": "New requirement"}, headers=headers).status_code == 204
    assert client.get(url, headers=headers).json == {"status": "waiting"}
    monkeypatch.setattr("app.services.agent.chat.provider_payloads", text_provider)
    execute_execution(execution_id)
    assert client.get(url, headers=headers).json == {"status": "received"}
