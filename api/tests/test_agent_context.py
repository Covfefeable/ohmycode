import json
import uuid
from types import SimpleNamespace

import httpx
from openai import APIStatusError

from app.models import AgentRun
from app.services.agent.chat import _tool_result_content
from app.services.agent.context import COMPACTION_RATIO, estimate_tokens
from app.services.agent.prompts import AGENT_SYSTEM_INSTRUCTIONS
from app.services.agent.provider_stream import PreparedCompletion, _payload, provider_payloads
from app.services.agent.task_plan import active_task_id, normalize_task_plan


def test_context_defaults_and_multilingual_token_estimate():
    assert COMPACTION_RATIO == 0.70
    assert estimate_tokens("a" * 400) == 100
    assert estimate_tokens("你好世界") == 4


def test_provider_chunk_uses_sdk_serialization():
    class Chunk:
        def to_dict(self):
            return {"choices": [], "provider_extension": "preserved"}

    assert _payload(Chunk()) == {"choices": [], "provider_extension": "preserved"}


def test_provider_automatically_retries_without_unsupported_stream_options(monkeypatch):
    requests = []
    client_options = {}

    class Chunk:
        def to_dict(self):
            return {"choices": [{"delta": {"content": "ok"}}]}

    def create(**payload):
        requests.append(payload)
        if len(requests) == 1:
            response = httpx.Response(
                400,
                request=httpx.Request("POST", "https://example.com/v1/chat/completions"),
            )
            raise APIStatusError("unsupported", response=response, body={})
        return [Chunk()]

    class Client:
        def __init__(self, **options):
            client_options.update(options)
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=create))

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

    monkeypatch.setattr("app.services.agent.provider_stream.OpenAI", Client)
    prepared = PreparedCompletion(
        run_id=uuid.uuid4(),
        conversation_id=uuid.uuid4(),
        endpoint="https://example.com/v1/chat/completions",
        api_key="secret",
        context_length=128_000,
        payload={
            "model": "example-model",
            "stream": True,
            "stream_options": {"include_usage": True},
        },
    )

    assert list(provider_payloads(prepared)) == [{"choices": [{"delta": {"content": "ok"}}]}]
    assert "stream_options" in requests[0]
    assert "stream_options" not in requests[1]
    assert client_options["base_url"] == "https://example.com/v1"


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
    assert (
        normalize_task_plan(
            {
                "tasks": [
                    {"id": "one", "content": "One", "status": "in_progress"},
                    {"id": "two", "content": "Two", "status": "in_progress"},
                ]
            }
        )[1]
        == "multiple_active_tasks"
    )


def test_agent_prompt_bundles_task_updates_with_real_work():
    assert "update_tasks and the next" in AGENT_SYSTEM_INSTRUCTIONS
    assert "same tool-call batch" in AGENT_SYSTEM_INSTRUCTIONS
