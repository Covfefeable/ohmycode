from types import SimpleNamespace

import pytest

from app.services.agent import suggestions


def test_clean_title_strips_quotes_punctuation_and_caps_length():
    assert suggestions._clean_title('"Fix login bug."') == "Fix login bug"
    assert suggestions._clean_title("标题。") == "标题"
    assert suggestions._clean_title("Title: hello") == "Title: hello"
    assert suggestions._clean_title(None) is None
    assert suggestions._clean_title("   ") is None
    for value in ("None", "null", "undefined", '"None"'):
        assert suggestions._clean_title(value) is None
    assert len(suggestions._clean_title("x" * 500)) == 200


def test_parse_suggestions_strips_markers_and_caps_count():
    raw = '1. Run the tests\n- "Review src/a.py"\n• Explain the fix\n4. Extra'
    parsed = suggestions._parse_suggestions(raw)
    assert parsed == ["Run the tests", "Review src/a.py", "Explain the fix"]
    assert suggestions._parse_suggestions(None) == []
    assert suggestions._parse_suggestions("") == []


def test_suggestion_prompt_uses_latest_ten_user_questions_and_last_reply():
    messages = []
    for index in range(12):
        messages.append(SimpleNamespace(role="user", content=f"question {index}"))
        messages.append(SimpleNamespace(role="assistant", content=f"reply {index}"))

    prompt = suggestions._suggestion_prompt(messages)

    assert prompt is not None
    question_lines = prompt.split("\n\nLatest agent reply:", 1)[0].splitlines()[1:]
    assert question_lines == [f"{index - 1}. question {index}" for index in range(2, 12)]
    for index in range(2, 12):
        assert f"{index - 1}. question {index}" in prompt
    assert "Latest agent reply:\nreply 11" in prompt
    assert "reply 10" not in prompt


def test_suggestion_prompt_requires_user_question_and_agent_reply():
    assert suggestions._suggestion_prompt([]) is None
    assert (
        suggestions._suggestion_prompt([SimpleNamespace(role="user", content="question")]) is None
    )


def test_maybe_rename_only_on_first_user_message(monkeypatch):
    calls = []
    completion = suggestions.AuxiliaryCompletion("Fix login bug", 8, 3)
    monkeypatch.setattr(
        suggestions,
        "_aux_completion",
        lambda *args, **kwargs: calls.append(args) or completion,
    )
    monkeypatch.setattr(suggestions.db.session, "commit", lambda *a, **k: None)
    monkeypatch.setattr(
        suggestions,
        "append_event",
        lambda run, event_type, payload: run.events.append(
            SimpleNamespace(event_type=event_type, payload=payload)
        ),
    )

    def conversation(user_count):
        return SimpleNamespace(
            title="New conversation",
            messages=[SimpleNamespace(role="user", content=f"msg {i}") for i in range(user_count)],
        )

    first = conversation(1)
    run = SimpleNamespace(events=[], input_tokens=10, output_tokens=None)
    suggestions.maybe_rename_new_conversation(first, object(), run)
    assert first.title == "Fix login bug"
    assert (run.input_tokens, run.output_tokens) == (18, 3)
    assert run.events[0].event_type == "conversation.title.generated"
    suggestions.maybe_rename_new_conversation(first, object(), run)
    assert len(calls) == 1

    later = conversation(3)
    later.title = "Established title"
    suggestions.maybe_rename_new_conversation(later, object())
    assert later.title == "Established title"


def test_maybe_rename_leaves_title_when_llm_fails(monkeypatch):
    monkeypatch.setattr(suggestions, "_aux_completion", lambda *args, **kwargs: None)
    monkeypatch.setattr(suggestions.db.session, "commit", lambda *a, **k: None)
    conversation = SimpleNamespace(
        title="New conversation",
        messages=[SimpleNamespace(role="user", content="help me")],
    )
    suggestions.maybe_rename_new_conversation(conversation, object())
    assert conversation.title == "New conversation"


def test_title_request_treats_user_content_as_data(monkeypatch):
    captured = {}

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"choices": [{"message": {"content": "修复登录问题"}}]}

    monkeypatch.setattr(
        suggestions.httpx,
        "post",
        lambda *_args, **kwargs: captured.update(kwargs) or Response(),
    )
    monkeypatch.setattr(suggestions, "decrypt_api_key", lambda _value: "secret")
    monkeypatch.setattr(suggestions.db.session, "commit", lambda: None)
    conversation = SimpleNamespace(
        title="New conversation",
        messages=[SimpleNamespace(role="user", content="修复登录问题并运行测试")],
    )
    configuration = SimpleNamespace(
        base_url="https://models.example/v1",
        model="model",
        api_key_encrypted="encrypted",
        reasoning_enabled=False,
    )

    suggestions.maybe_rename_new_conversation(conversation, configuration)

    payload = captured["json"]
    assert payload["max_tokens"] == 2048
    assert "not a coding agent" in payload["messages"][0]["content"]
    assert payload["messages"][1]["content"].startswith("<user-request>\n")
    assert payload["messages"][1]["content"].endswith("\n</user-request>")


@pytest.mark.parametrize(
    "content,finish_reason", [(None, "stop"), ([], "stop"), ("", "stop"), ("partial", "length")]
)
def test_auxiliary_completion_rejects_missing_or_truncated_text(
    monkeypatch, content, finish_reason
):
    response = SimpleNamespace(
        raise_for_status=lambda: None,
        json=lambda: {
            "choices": [{"message": {"content": content}, "finish_reason": finish_reason}]
        },
    )
    monkeypatch.setattr(suggestions.httpx, "post", lambda *a, **k: response)
    monkeypatch.setattr(suggestions, "decrypt_api_key", lambda _: "test-key")
    configuration = SimpleNamespace(
        base_url="https://models.example/v1",
        model="model",
        api_key_encrypted="encrypted",
        reasoning_enabled=False,
    )
    assert suggestions._aux_completion(configuration, "system", "user") is None


def test_invalid_cached_title_can_be_regenerated_after_first_turn(monkeypatch):
    monkeypatch.setattr(
        suggestions,
        "_aux_completion",
        lambda *a, **k: suggestions.AuxiliaryCompletion("Repair conversation titles", 4, 3),
    )
    monkeypatch.setattr(suggestions.db.session, "commit", lambda: None)
    monkeypatch.setattr(
        suggestions,
        "append_event",
        lambda run, kind, payload: run.events.append(
            SimpleNamespace(event_type=kind, payload=payload)
        ),
    )
    conversation = SimpleNamespace(
        title="None",
        messages=[
            SimpleNamespace(role="user", content="Fix titles"),
            SimpleNamespace(role="user", content="Try again"),
        ],
    )
    run = SimpleNamespace(
        events=[
            SimpleNamespace(event_type="conversation.title.generated", payload={"title": "None"})
        ],
        input_tokens=0,
        output_tokens=0,
    )
    suggestions.maybe_rename_new_conversation(conversation, object(), run)
    assert conversation.title == "Repair conversation titles"
    assert run.events[-1].payload["title"] == "Repair conversation titles"


def test_title_generation_is_independent_of_followup_suggestions_setting(monkeypatch):
    conversation = SimpleNamespace(
        messages=[
            SimpleNamespace(role="user", content="Task"),
            SimpleNamespace(role="assistant", content="Done"),
        ]
    )
    configuration, run = object(), object()
    calls = []
    monkeypatch.setattr(suggestions, "get_conversation", lambda *a: conversation)
    monkeypatch.setattr(
        suggestions,
        "background_task_settings",
        lambda _: SimpleNamespace(suggestions_enabled=False, suggestions_model_id=None),
    )
    monkeypatch.setattr(suggestions, "_configuration_for", lambda *a: (configuration, run))
    monkeypatch.setattr(suggestions, "configured_model", lambda *a: configuration)
    monkeypatch.setattr(suggestions, "maybe_rename_new_conversation", lambda *a: calls.append(a))
    monkeypatch.setattr(suggestions.db.session, "commit", lambda: None)
    assert suggestions.generate_followup_suggestions("user", "conversation") == []
    assert calls == [(conversation, configuration, run)]
