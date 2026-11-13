import json
from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

from app.services.agent.context_history import (
    HISTORY_RESULT_TOKEN_BUDGET,
    _run_context_message,
    branch_context_snapshot,
    project_context_snapshot,
)
from app.services.agent.tokens import estimate_tokens
from app.services.agent.tool_history import tool_batches, tool_result_content
from app.services.agent.tool_results import render_tool_result


def event(sequence, kind, payload):
    return SimpleNamespace(sequence=sequence, event_type=kind, payload=payload)


def patch_result():
    before = "FULL_FILE_SENTINEL\n" + "unchanged context\n" * 2000 + "old value\n"
    return {
        "operation": "apply_patch",
        "path": "/repo/page.ts",
        "pathKind": "file",
        "output": "Updated 1 file(s).",
        "affectedPaths": ["/repo/page.ts"],
        "changes": [
            {
                "path": "/repo/page.ts",
                "original": before,
                "modified": before.replace("old value", "new value"),
            }
        ],
    }


def test_patch_projection_preserves_diff_and_raw_evidence_without_resending_full_files():
    result = patch_result()
    original = deepcopy(result)
    run = SimpleNamespace(id=uuid4())
    rendered = tool_result_content(run, {"callId": "patch", "result": result}, 4000)
    projected = json.loads(rendered)
    change = projected["changes"][0]
    assert change["addedLines"] == change["removedLines"] == 1
    assert change["diffTruncated"] is False
    assert "-old value" in change["diffPreview"]
    assert "+new value" in change["diffPreview"]
    assert "FULL_FILE_SENTINEL" not in rendered
    assert projected["resultRef"] == {"runId": str(run.id), "callId": "patch"}
    assert result == original
    assert json.loads(render_tool_result(result)) == original
    assert len(rendered) < len(json.dumps(result)) / 20


def test_patch_preview_truncation_points_to_start_of_raw_evidence():
    result = patch_result()
    result["changes"][0]["modified"] = "new content " * 1000
    run = SimpleNamespace(id=uuid4())
    rendered = tool_result_content(run, {"callId": "patch", "result": result}, 300)
    manifest = json.loads(rendered)
    assert estimate_tokens(rendered) <= 300
    assert manifest["contextTruncated"]
    assert manifest["nextCursor"] == 0
    assert '"original"' not in manifest["preview"]
    assert '"modified"' not in manifest["preview"]
    assert manifest["totalCharacters"] == len(render_tool_result(result))


def test_tool_failure_details_survive_projection():
    result = {"error": "inspection_required:/repo/page.ts", "exitCode": 1}
    run = SimpleNamespace(
        id=uuid4(),
        summary=None,
        events=[
            event(1, "tool.output", {"results": [{"callId": "failed", "result": result}]}),
        ],
    )
    projected = json.loads(_run_context_message(run, protected=True)["content"].split("\n", 1)[1])
    assert projected[0]["result"] == result


def test_completed_history_pairs_tools_bounds_results_and_excludes_reasoning_and_progress():
    run = SimpleNamespace(id=uuid4(), summary=None)
    run.events = [
        event(1, "reasoning.completed", {"content": "PRIVATE_REASONING" * 1000}),
        event(2, "message.progress", {"content": "DUPLICATE_PROGRESS"}),
        event(
            3,
            "tool.requested",
            {
                "toolCalls": [
                    {
                        "id": "patch",
                        "function": {
                            "name": "apply_patch",
                            "arguments": json.dumps({"patch": "PATCH_ARGUMENT" * 10000}),
                        },
                    },
                    {
                        "id": "read",
                        "function": {"name": "read_file", "arguments": '{"path":"page.ts"}'},
                    },
                ]
            },
        ),
        event(
            4,
            "tool.output",
            {
                "results": [
                    {"callId": "patch", "result": patch_result()},
                    {"callId": "read", "result": {"output": "large output " * 10000}},
                ]
            },
        ),
        event(5, "input.received", {"contextContent": "Preserve keyboard access"}),
        event(6, "task.plan.updated", {"tasks": [{"id": "verify", "status": "completed"}]}),
    ]
    original = deepcopy(run.events)
    message = _run_context_message(run, protected=True)
    content = message["content"]
    assert message["role"] == "assistant"
    assert not any(
        marker in content
        for marker in (
            "Complete AgentEvent history",
            "PRIVATE_REASONING",
            "DUPLICATE_PROGRESS",
            "PATCH_ARGUMENT",
            "FULL_FILE_SENTINEL",
        )
    )
    observations = json.loads(content.split("\n", 1)[1])
    assert [item["tool"] for item in observations[:2]] == ["apply_patch", "read_file"]
    for item in observations[:2]:
        assert (
            estimate_tokens(json.dumps(item["result"], ensure_ascii=False))
            <= HISTORY_RESULT_TOKEN_BUDGET
        )
        assert item["resultRef"]["runId"] == str(run.id)
    assert "Preserve keyboard access" in content
    assert '"status":"completed"' in content
    assert [vars(item) for item in run.events] == [vars(item) for item in original]
    assert len(content) < len(json.dumps([vars(item) for item in run.events])) / 10
    # Active turns keep native call/result pairs and pending state, not the completed projection.
    batches = tool_batches(run, supports_vision=False)
    assert batches[0].messages[0]["tool_calls"][0]["id"] == "patch"
    assert [item["tool_call_id"] for item in batches[0].messages[1:]] == ["patch", "read"]


def test_branch_archives_are_projected_on_every_read_without_replacing_the_archive():
    run_id = uuid4()
    events = [
        {
            "sequence": 1,
            "type": "tool.output",
            "payload": {
                "results": [{"callId": "patch", "result": patch_result()}],
            },
        }
    ]
    snapshot = [
        {
            "role": "system",
            "content": f"Complete AgentEvent history for completed turn {run_id}:\n"
            + json.dumps(events),
        }
    ]
    original = deepcopy(snapshot)
    projected = project_context_snapshot(snapshot)
    assert "FULL_FILE_SENTINEL" not in str(projected)
    assert projected[0]["role"] == "assistant"
    assert snapshot == original
    message = SimpleNamespace(context_snapshot=snapshot)
    assert branch_context_snapshot(message) == original


def test_failed_or_disabled_summary_uses_the_same_bounded_history_and_cursor():
    run = SimpleNamespace(
        id=uuid4(),
        summary=SimpleNamespace(status="failed", summary=None),
        events=[
            event(1, "tool.output", {"results": [{"callId": "old", "result": "covered"}]}),
            event(2, "tool.output", {"results": [{"callId": "new", "result": "remaining"}]}),
        ],
    )
    content = _run_context_message(run, protected=False, after_sequence=1)["content"]
    assert "covered" not in content
    assert "remaining" in content
    run.summary = None
    assert _run_context_message(run, protected=False, after_sequence=1)["content"] == content
