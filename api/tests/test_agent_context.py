from app.services.agent.chat import _truncate_tool_content
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


def test_tool_results_are_truncated_to_budget_with_actionable_hint():
    content = "prefix\n" + ("large-result " * 2000) + "\nsuffix"
    truncated = _truncate_tool_content(content, 120)

    assert estimate_tokens(truncated) <= 120
    assert truncated.startswith("prefix")
    assert truncated.endswith("suffix")
    assert "narrower query/path" in truncated


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
