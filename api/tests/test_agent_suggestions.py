from types import SimpleNamespace

from app.services.agent import suggestions


def test_clean_title_strips_quotes_punctuation_and_caps_length():
    assert suggestions._clean_title('"Fix login bug."') == "Fix login bug"
    assert suggestions._clean_title("标题。") == "标题"
    assert suggestions._clean_title("Title: hello") == "Title: hello"
    assert suggestions._clean_title(None) is None
    assert suggestions._clean_title("   ") is None
    assert len(suggestions._clean_title("x" * 500)) == 200


def test_parse_suggestions_strips_markers_and_caps_count():
    raw = "1. Run the tests\n- \"Review src/a.py\"\n• Explain the fix\n4. Extra"
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
    assert question_lines == [
        f"{index - 1}. question {index}" for index in range(2, 12)
    ]
    for index in range(2, 12):
        assert f"{index - 1}. question {index}" in prompt
    assert "Latest agent reply:\nreply 11" in prompt
    assert "reply 10" not in prompt


def test_suggestion_prompt_requires_user_question_and_agent_reply():
    assert suggestions._suggestion_prompt([]) is None
    assert suggestions._suggestion_prompt(
        [SimpleNamespace(role="user", content="question")]
    ) is None


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
    suggestions.maybe_rename_new_conversation(later, object())
    assert later.title == "New conversation"


def test_maybe_rename_leaves_title_when_llm_fails(monkeypatch):
    monkeypatch.setattr(suggestions, "_aux_completion", lambda *args, **kwargs: None)
    monkeypatch.setattr(suggestions.db.session, "commit", lambda *a, **k: None)
    conversation = SimpleNamespace(
        title="New conversation",
        messages=[SimpleNamespace(role="user", content="help me")],
    )
    suggestions.maybe_rename_new_conversation(conversation, object())
    assert conversation.title == "New conversation"
