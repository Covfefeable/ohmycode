import json
import subprocess
import sys
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from app import create_app
from app.extensions import db
from app.models import (
    AgentEvent,
    AgentRun,
    Conversation,
    Message,
    ModelConfiguration,
    MultiAgent,
    MultiAgentNode,
    MultiAgentTask,
    Project,
    User,
)
from app.services.agent.runs import append_event
from evals.cases import fixture_files, load_cases, prepare_case
from evals.cli import main
from evals.metrics import collect_metrics, metric_value
from evals.report import case_digest, compare, score
from evals.source import Trace, load_trace


@pytest.fixture
def recorded_run():
    app = create_app("testing")
    with app.app_context():
        db.create_all()
        user = User(email="eval@example.com", display_name="Evaluator", password_hash="unused")
        db.session.add(user)
        db.session.flush()
        project = Project(
            user_id=user.id, device_id="eval", device_name="Eval", name="Repo", path="/repo"
        )
        db.session.add(project)
        db.session.flush()
        conversation = Conversation(project_id=project.id)
        model = ModelConfiguration(
            user_id=user.id,
            name="Model",
            model="model",
            base_url="https://example.com",
            api_key_encrypted=b"not-exported",
        )
        db.session.add_all([conversation, model])
        db.session.flush()
        now = datetime.now(UTC)
        run = AgentRun(
            conversation_id=conversation.id,
            model_configuration_id=model.id,
            status="completed",
            started_at=now,
            completed_at=now + timedelta(seconds=2),
            input_tokens=100,
            output_tokens=20,
            last_event_sequence=0,
        )
        db.session.add(run)
        db.session.flush()
        append_event(run, "run.started", {"modelId": str(model.id)})
        append_event(run, "context.prepared", {"estimatedTokens": 100})
        append_event(run, "run.completed")
        db.session.add(
            Message(
                conversation=conversation,
                agent_run_id=run.id,
                role="assistant",
                content="The expression is left + right.",
            )
        )
        db.session.commit()
        yield SimpleNamespace(
            app=app, user=user, project=project, conversation=conversation, run=run
        )


def tool_call(run, name, arguments, result, *, call_id):
    append_event(
        run,
        "tool.requested",
        {
            "toolCalls": [
                {
                    "id": call_id,
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": json.dumps(arguments),
                    },
                }
            ]
        },
    )
    append_event(run, "tool.output", {"results": [{"callId": call_id, "result": result}]})
    db.session.commit()


def small_case():
    return {
        "id": "test",
        "fixtures": ["repo"],
        "status": "completed",
        "review": ["结果正确"],
        "max": {"tool_calls.read_file": 2, "model_steps": 3},
    }


def test_metrics_are_collected_from_existing_events_without_exporting_payloads(recorded_run):
    w = recorded_run
    tool_call(
        w.run,
        "read_file",
        {"path": "a.py", "startLine": 1},
        {"content": "private-body"},
        call_id="one",
    )
    tool_call(
        w.run,
        "read_file",
        {"startLine": 1, "path": "a.py"},
        {"content": "private-body"},
        call_id="two",
    )
    tool_call(
        w.run,
        "terminal",
        {"command": "test", "token": "not-exported"},
        {"exitCode": 1},
        call_id="three",
    )
    metrics = collect_metrics(load_trace(run_id=w.run.id))
    assert metrics["trace_complete"] is True
    assert metrics["model_steps"] == 1
    assert metrics["tool_call_count"] == 3
    assert metrics["tool_calls"]["read_file"] == 2
    assert metrics["repeated_calls"]["read_file"] == 1
    assert metrics["tool_failures"]["terminal"] == 1
    assert metrics["run_duration_ms"] == 2000
    assert metrics["input_tokens"] == 100
    assert metrics["output_tokens"] == 20
    assert "private-body" not in json.dumps(metrics)
    assert "not-exported" not in json.dumps(metrics)
    assert metric_value(metrics, "tool_calls.apply_patch") == 0


def test_repeats_are_not_counted_between_independent_agents(recorded_run):
    w = recorded_run
    other = AgentRun(conversation_id=w.conversation.id, status="completed", last_event_sequence=0)
    db.session.add(other)
    db.session.flush()
    tool_call(w.run, "read_file", {"path": "a.py"}, "first", call_id="same-call-id")
    tool_call(other, "read_file", {"path": "a.py"}, "second", call_id="same-call-id")
    metrics = collect_metrics(Trace([w.run, other], [], "completed"))
    assert metrics["tool_calls"]["read_file"] == 2
    assert metrics["repeated_calls"]["read_file"] == 0
    assert metrics["pending_tools"] == 0
    assert metrics["input_tokens"] is None
    assert metrics["output_tokens"] is None
    assert metrics["run_duration_ms"] is None


@pytest.mark.parametrize(
    "review, expected", [(None, "incomplete"), ("passed", "passed"), ("failed", "failed")]
)
def test_human_acceptance_is_explicit(recorded_run, review, expected):
    report = score(
        small_case(),
        load_trace(run_id=recorded_run.run.id),
        label="baseline",
        review=review,
        workspace=None,
    )
    assert report["outcome"] == expected


def test_metrics_failure_cannot_be_overridden_by_human_acceptance(recorded_run):
    case = small_case()
    case["max"]["model_steps"] = 0
    report = score(
        case,
        load_trace(run_id=recorded_run.run.id),
        label="baseline",
        review="passed",
        workspace=None,
    )
    assert report["outcome"] == "failed"


def test_cleaned_or_incomplete_event_history_is_not_scored_as_success(recorded_run):
    w = recorded_run
    db.session.execute(
        db.delete(AgentEvent).where(AgentEvent.run_id == w.run.id, AgentEvent.sequence == 2)
    )
    db.session.commit()
    db.session.expire(w.run, ["events"])
    case = small_case()
    case["min"] = {"tool_calls.read_file": 1}
    report = score(
        case, load_trace(run_id=w.run.id), label="baseline", review="passed", workspace=None
    )
    assert report["outcome"] == "incomplete"
    assert report["checks"][0]["status"] == "unavailable"


def test_missing_usage_is_not_zero_and_cannot_pass_a_token_budget(recorded_run):
    w = recorded_run
    w.run.input_tokens = None
    db.session.commit()
    case = small_case()
    case["max"]["input_tokens"] = 1000
    report = score(
        case, load_trace(run_id=w.run.id), label="baseline", review="passed", workspace=None
    )
    assert report["metrics"]["input_tokens"] is None
    assert report["outcome"] == "incomplete"


def test_pending_calls_and_failures_use_existing_result_contract(recorded_run):
    w = recorded_run
    tool_call(w.run, "read_file", {"path": "missing"}, {"error": "not_found"}, call_id="failed")
    tool_call(w.run, "external_tool", {}, {"isError": True, "content": []}, call_id="mcp-error")
    append_event(
        w.run,
        "tool.requested",
        {"toolCalls": [{"id": "pending", "function": {"name": "terminal", "arguments": "{}"}}]},
    )
    metrics = collect_metrics(Trace([w.run], [], "completed"))
    assert metrics["pending_tools"] == 1
    assert metrics["tool_failures"]["read_file"] == 1
    assert metrics["tool_failures"]["external_tool"] == 1


def test_compactions_count_persisted_completion_instead_of_start(recorded_run):
    run = recorded_run.run
    append_event(run, "context.compaction.started")
    trace = Trace([run], [], "completed")
    assert collect_metrics(trace)["compactions"] == 0
    append_event(run, "context.compacted", {"checkpointId": "test-checkpoint"})
    assert collect_metrics(trace)["compactions"] == 1


def test_artifacts_are_checked_in_the_requested_workspace(recorded_run, tmp_path):
    case = small_case()
    case["files"] = [
        {"path": "result.txt", "equals": "done\n"},
        {"path": "unused.txt", "absent": True},
    ]
    trace = load_trace(run_id=recorded_run.run.id)
    assert (
        score(case, trace, label="run", review="passed", workspace=None)["outcome"] == "incomplete"
    )
    assert (
        score(case, trace, label="run", review="passed", workspace=tmp_path)["outcome"] == "failed"
    )
    (tmp_path / "result.txt").write_text("done\n", encoding="utf-8")
    assert (
        score(case, trace, label="run", review="passed", workspace=tmp_path)["outcome"] == "passed"
    )


def test_artifact_paths_cannot_escape_the_workspace(recorded_run, tmp_path):
    case = small_case()
    case["files"] = [{"path": "../outside.txt", "absent": True}]
    with pytest.raises(ValueError):
        score(
            case,
            load_trace(run_id=recorded_run.run.id),
            label="run",
            review="passed",
            workspace=tmp_path,
        )


def test_database_loader_scopes_a_group_task_to_its_members(recorded_run):
    w = recorded_run
    agent = MultiAgent(user_id=w.user.id, name="Team")
    db.session.add(agent)
    db.session.flush()
    task = MultiAgentTask(
        agent_id=agent.id,
        project_id=w.project.id,
        title="Task",
        request="Ask",
        status="waiting_user",
    )
    db.session.add(task)
    db.session.flush()
    db.session.add(
        MultiAgentNode(
            task_id=task.id,
            conversation_id=w.conversation.id,
            key="host",
            name="Host",
            role="Host",
            instructions="Ask",
        )
    )
    unrelated = Conversation(project_id=w.project.id)
    db.session.add(unrelated)
    db.session.flush()
    db.session.add(AgentRun(conversation_id=unrelated.id, status="completed"))
    db.session.commit()
    trace = load_trace(task_id=task.id)
    assert trace.status == "waiting_user"
    assert [run.id for run in trace.runs] == [w.run.id]
    assert trace.answers == ["The expression is left + right."]


def test_comparison_includes_tool_metrics_and_keeps_missing_usage_unknown(recorded_run):
    baseline = score(
        small_case(),
        load_trace(run_id=recorded_run.run.id),
        label="old",
        review="passed",
        workspace=None,
    )
    baseline = json.loads(json.dumps(baseline))
    after = deepcopy(baseline)
    after["label"] = "new"
    after["metrics"]["tool_calls"]["read_file"] = 2
    after["metrics"]["input_tokens"] = None
    after["metrics"]["model_steps"] = 3
    result = compare([baseline], [after])
    assert result["cases"][0]["metric_deltas"]["tool_calls.read_file"] == 2
    assert result["cases"][0]["metric_deltas"]["model_steps"] == 2
    assert result["cases"][0]["metric_deltas"]["input_tokens"] is None


def test_comparison_rejects_changed_requirements_or_different_case_sets(recorded_run):
    baseline = score(
        small_case(),
        load_trace(run_id=recorded_run.run.id),
        label="old",
        review="passed",
        workspace=None,
    )
    after = deepcopy(baseline)
    after["case_digest"] = "different"
    with pytest.raises(ValueError, match="要求已变化"):
        compare([baseline], [after])
    with pytest.raises(ValueError, match="用例不一致"):
        compare([baseline], [])
    with pytest.raises(ValueError, match="出现多次"):
        compare([baseline, baseline], [baseline])


def test_case_fixtures_are_isolated_and_overlays_keep_unrelated_files(monkeypatch, tmp_path):
    monkeypatch.setattr("evals.cases.tempfile.mkdtemp", lambda **_: str(tmp_path))
    case = next(case for case in load_cases() if case["id"] == "narrow-fix")
    workspace = prepare_case(case)
    assert "left - right" in (workspace / "src/calculator.py").read_text()
    assert (workspace / "notes.txt").read_bytes() == fixture_files(case)["notes.txt"].read_bytes()
    before = case_digest(case)
    (workspace / "src/calculator.py").write_text("user changed this", encoding="utf-8")
    assert case_digest(case) == before


def test_case_digest_includes_fixture_contents(monkeypatch, tmp_path):
    fixture = tmp_path / "source.txt"
    fixture.write_text("before", encoding="utf-8")
    monkeypatch.setattr("evals.report.fixture_files", lambda _: {"source.txt": fixture})
    before = case_digest(small_case())
    fixture.write_text("after", encoding="utf-8")
    assert case_digest(small_case()) != before


def test_generated_python_cache_does_not_change_fixture_inputs(monkeypatch, tmp_path):
    fixture = tmp_path / "fixtures/repo"
    fixture.mkdir(parents=True)
    (fixture / "source.py").write_text("value = 1\n", encoding="utf-8")
    monkeypatch.setattr("evals.cases.DATA", tmp_path)
    before = case_digest(small_case())
    cache = fixture / "__pycache__"
    cache.mkdir()
    (cache / "source.cpython-312.pyc").write_bytes(b"generated")
    assert list(fixture_files(small_case())) == ["source.py"]
    assert case_digest(small_case()) == before


def test_catalog_has_fixed_cases_with_explicit_acceptance():
    cases = load_cases()
    assert len(cases) == 20
    for case in cases:
        assert case["prompt"] and case["review"] and fixture_files(case)


def test_cli_scores_real_records_and_does_not_export_credentials(
    recorded_run, monkeypatch, tmp_path
):
    w = recorded_run
    monkeypatch.setattr("app.create_app", lambda _: w.app)
    output = tmp_path / "report.json"
    assert (
        main(
            [
                "score",
                "symbol-question",
                "--run-id",
                str(w.run.id),
                "--label",
                "test",
                "--review",
                "passed",
                "--output",
                str(output),
            ]
        )
        == 2
    )
    # The file check remains unavailable until the real workspace is supplied.
    assert json.loads(output.read_text())["outcome"] == "incomplete"
    assert "not-exported" not in output.read_text()
    assert "The expression" not in output.read_text()


def test_cli_lists_cases_without_a_database_or_network(capsys):
    assert main(["list"]) == 0
    assert "narrow-fix" in capsys.readouterr().out


def test_prepared_fixture_tests_run_with_only_the_standard_library(monkeypatch, tmp_path):
    monkeypatch.setattr("evals.cases.tempfile.mkdtemp", lambda **_: str(tmp_path))
    case = next(case for case in load_cases() if case["id"] == "symbol-question")
    workspace = prepare_case(case)
    result = subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"],
        cwd=workspace,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
