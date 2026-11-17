from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services.agent import operation_approval as approval
from app.services.agent.config import MODEL_REQUEST_TIMEOUT_SECONDS


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        ('{"decision":"allow"}', {"decision": "allow"}),
        ('{"decision":"ask","reason":"Risk"}', {"decision": "ask", "reason": "Risk"}),
        ("invalid", {"decision": "ask"}),
        ("null", {"decision": "ask"}),
        (None, {"decision": "ask"}),
    ],
)
def test_assessment_uses_selected_model_and_normal_timeout(monkeypatch, content, expected):
    user_id, model_id = uuid4(), uuid4()
    configuration = object()
    monkeypatch.setattr(
        approval,
        "background_task_settings",
        lambda _: SimpleNamespace(operation_approval_model_id=model_id),
    )

    def configured(uid, mid):
        assert (uid, mid) == (user_id, model_id)
        return configuration

    def complete(model, system, prompt, **options):
        assert model is configuration
        assert options["timeout"] == MODEL_REQUEST_TIMEOUT_SECONDS
        assert "git status" in prompt
        assert "triggerReason" not in prompt
        return SimpleNamespace(content=content) if content is not None else None

    monkeypatch.setattr(approval, "configured_model", configured)
    monkeypatch.setattr(approval, "_aux_completion", complete)
    assert approval.assess_operation(user_id, {"details": "git status"}) == expected


def test_missing_model_asks_user(monkeypatch):
    monkeypatch.setattr(
        approval,
        "background_task_settings",
        lambda _: SimpleNamespace(operation_approval_model_id=None),
    )
    monkeypatch.setattr(approval, "configured_model", lambda *_: None)
    assert approval.assess_operation(uuid4(), {"details": "command"}) == {"decision": "ask"}
