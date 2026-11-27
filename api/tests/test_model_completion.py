import json
from types import SimpleNamespace

import httpx
import pytest

from app.services import model_completion
from app.services.agent.context import _summary_request


@pytest.fixture
def provider(monkeypatch):
    requests = []
    state = SimpleNamespace(
        status=200,
        payload={
            "choices": [{"message": {"content": " Answer "}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 12, "completion_tokens": 3},
        },
    )

    def handle(request):
        requests.append(request)
        return httpx.Response(state.status, json=state.payload)

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        monkeypatch.setattr(model_completion.httpx, "post", client.post)
        monkeypatch.setattr(model_completion, "decrypt_api_key", lambda _: "test-key")
        yield SimpleNamespace(
            state=state,
            requests=requests,
            model=SimpleNamespace(
                base_url="https://models.example/v1/",
                model="test-model",
                api_key_encrypted=b"encrypted",
                reasoning_enabled=True,
                reasoning_levels=[{"name": "Light", "key": "low"}],
            ),
        )


@pytest.mark.parametrize(
    "enabled,effort,expected",
    [
        (True, "low", "low"),
        (True, "", None),
        (False, "low", None),
    ],
)
def test_auxiliary_request_sends_effort_only_when_enabled(provider, enabled, effort, expected):
    provider.model.reasoning_enabled = enabled
    result = model_completion.auxiliary_completion(
        provider.model, "System", "User", timeout=17, max_tokens=1024, reasoning_effort=effort
    )
    assert result == model_completion.AuxiliaryCompletion("Answer", 12, 3)
    request = provider.requests[0]
    assert str(request.url) == "https://models.example/v1/chat/completions"
    assert request.headers["Authorization"] == "Bearer test-key"
    assert request.extensions["timeout"]["read"] == 17
    body = json.loads(request.content)
    assert body["max_tokens"] == 1024 and body["stream"] is False
    assert body.get("reasoning_effort") == expected
    if expected is None:
        assert "reasoning_effort" not in body


@pytest.mark.parametrize("status", [400, 429, 500])
def test_http_errors_still_fail_closed_for_auxiliary_and_raise_for_summary(provider, status):
    provider.state.status = status
    assert model_completion.auxiliary_completion(provider.model, "System", "User") is None
    with pytest.raises(httpx.HTTPStatusError):
        _summary_request(provider.model, "History")


@pytest.mark.parametrize(
    "content,finish", [(None, "stop"), ([], "stop"), ("", "stop"), ("Partial", "length")]
)
def test_summary_rejects_missing_nontext_or_truncated_content(provider, content, finish):
    provider.state.payload = {
        "choices": [{"message": {"content": content}, "finish_reason": finish}]
    }
    with pytest.raises(ValueError):
        _summary_request(provider.model, "History")


def test_summary_preserves_budget_effort_and_timeout(provider):
    assert (
        _summary_request(provider.model, "History", max_tokens=64, reasoning_effort="low")
        == "Answer"
    )
    request = provider.requests[0]
    body = json.loads(request.content)
    assert body["reasoning_effort"] == "low"
    assert body["max_tokens"] == 64
    assert request.extensions["timeout"]["read"] == 120
