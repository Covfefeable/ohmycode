import json
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import httpx
from openai import APIStatusError

from app import create_app
from app.extensions import db
from app.models import (
    AgentEvent,
    AgentRun,
    AgentRunSummary,
    Conversation,
    Message,
    ModelConfiguration,
    Project,
    User,
)
from app.services.agent import turn_summaries
from app.services.agent.chat import _tool_result_content
from app.services.agent.context import (
    COMPACTION_RATIO,
    _protected_run_ids,
    _render_messages,
    estimate_tokens,
)
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


def test_turn_context_uses_summaries_only_before_the_latest_two_turns(monkeypatch):
    app = create_app("testing")
    with app.app_context():
        db.create_all()
        user = User(
            email="context-turns@example.com",
            display_name="Context Turns",
            password_hash="unused",
        )
        db.session.add(user)
        db.session.flush()
        project = Project(
            user_id=user.id,
            device_id="desktop",
            device_name="Desktop",
            name="workspace",
            path="/workspace",
        )
        db.session.add(project)
        db.session.flush()
        conversation = Conversation(project_id=project.id)
        model = ModelConfiguration(
            user_id=user.id,
            name="Model",
            base_url="https://example.com/v1",
            model="example",
            api_key_encrypted=b"secret",
        )
        db.session.add_all([conversation, model])
        db.session.flush()
        messages = []
        runs = []
        for number in range(1, 4):
            user_message = Message(
                conversation_id=conversation.id,
                role="user",
                content=f"user-{number}",
            )
            run = AgentRun(
                conversation_id=conversation.id,
                model_configuration_id=model.id,
                status="completed",
                last_event_sequence=1,
                completed_at=datetime.now(UTC) + timedelta(seconds=number),
            )
            db.session.add_all([user_message, run])
            db.session.flush()
            db.session.add(
                AgentEvent(
                    run=run,
                    sequence=1,
                    event_type="tool.output",
                    payload={"turn": number},
                )
            )
            assistant = Message(
                conversation_id=conversation.id,
                agent_run_id=run.id,
                role="assistant",
                content=f"assistant-{number}",
            )
            db.session.add(assistant)
            messages.extend([user_message, assistant])
            runs.append(run)
        db.session.add(
            AgentRunSummary(
                run=runs[0],
                conversation_id=conversation.id,
                status="completed",
                source_last_sequence=1,
                source_digest="digest",
                source_size=100,
                summary="summary-one",
            )
        )
        db.session.add(
            AgentRunSummary(
                run=runs[1],
                conversation_id=conversation.id,
                status="pending",
                source_last_sequence=1,
                source_digest="pending",
                source_size=100,
            )
        )
        db.session.commit()

        rendered = _render_messages(messages, _protected_run_ids(messages))
        system_messages = [item["content"] for item in rendered if item["role"] == "system"]

        assert "summary-one" in system_messages[0]
        assert "Complete AgentEvent history" in system_messages[1]
        assert "Complete AgentEvent history" in system_messages[2]
        assert [item["content"] for item in rendered if item["role"] == "user"] == [
            "user-1",
            "user-2",
            "user-3",
        ]

        runs[0].summary.status = "failed"
        monkeypatch.setattr(turn_summaries, "TURN_SUMMARY_SOURCE_BYTES", 1)
        assert turn_summaries.enqueue_turn_summaries(conversation.id) == [runs[0].id]
        assert runs[0].summary.status == "pending"
        assert runs[1].summary.status == "pending"
        assert runs[2].summary is None
        monkeypatch.setattr(
            turn_summaries,
            "_summary_request",
            lambda _model, _content, _instructions: "generated-summary",
        )
        assert turn_summaries.summarize_agent_run(runs[0].id) is True
        assert runs[0].summary.status == "completed"
        assert runs[0].summary.summary == "generated-summary"


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
