import json
import uuid

from app.models import AgentRun
from app.services.agent.chat import _tool_result_content
from app.services.agent.context import COMPACTION_RATIO, estimate_tokens
from app.services.agent.prompts import AGENT_SYSTEM_INSTRUCTIONS
from app.services.agent.provider_stream import sse_json_payloads
from app.services.agent.task_plan import active_task_id, normalize_task_plan


def test_context_defaults_and_multilingual_token_estimate():
    assert COMPACTION_RATIO == 0.70
    assert estimate_tokens("a" * 400) == 100
    assert estimate_tokens("你好世界") == 4


def test_sse_parser_ignores_control_fields_and_supports_multiline_data():
    lines = [
        ": keep-alive",
        "event: message",
        "id: 1",
        "data: {",
        'data: "choices": []',
        "data: }",
        "",
        "event: done",
        "data: [DONE]",
        "",
    ]

    assert list(sse_json_payloads(lines)) == [{"choices": []}]


def test_large_tool_results_return_a_pageable_reference_without_dropping_silently():
    content = "prefix\n" + ("large-result " * 2000) + "\nsuffix"
    run = AgentRun(id=uuid.uuid4())
    rendered = _tool_result_content(
        run,
        {"callId": "call-long", "result": {"content": content}},
        300,
    )
    manifest = json.loads(rendered)

    assert estimate_tokens(rendered) <= 300
    assert manifest["contextTruncated"] is True
    assert manifest["resultRef"] == {
        "runId": str(run.id),
        "callId": "call-long",
    }
    assert manifest["preview"].startswith('{"content": "prefix')
    assert "suffix" not in manifest["preview"]
    assert 0 < manifest["nextCursor"] < manifest["totalCharacters"]
    assert "read_tool_result" in manifest["instructions"]


def test_agent_prompt_requires_meaningful_visible_progress():
    assert "Before a meaningful tool sequence" in AGENT_SYSTEM_INSTRUCTIONS
    assert "diagnosis, implementation, or validation" in AGENT_SYSTEM_INSTRUCTIONS


def test_task_plan_is_bounded_and_has_only_one_active_task():
    tasks, error = normalize_task_plan(
        {
            "tasks": [
                {"id": "inspect", "content": "Inspect the relevant path", "status": "completed"},
                {"id": "implement", "content": "Implement the change", "status": "in_progress"},
                {"id": "verify", "content": "Run focused checks", "status": "pending"},
            ]
        }
    )

    assert error is None
    assert tasks is not None
    assert active_task_id(tasks) == "implement"
    assert normalize_task_plan(
        {
            "tasks": [
                {"id": "one", "content": "One", "status": "in_progress"},
                {"id": "two", "content": "Two", "status": "in_progress"},
            ]
        }
    )[1] == "multiple_active_tasks"


def test_agent_prompt_bundles_task_updates_with_real_work():
    assert "update_tasks and the next" in AGENT_SYSTEM_INSTRUCTIONS
    assert "same tool-call batch" in AGENT_SYSTEM_INSTRUCTIONS
