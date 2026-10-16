import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import httpx
import pytest

from app import create_app
from app.extensions import db
from app.models import (
    ContextCheckpoint,
    Conversation,
    Message,
    ModelConfiguration,
    MultiAgent,
    MultiAgentMessage,
    MultiAgentNode,
    MultiAgentTask,
    Project,
    User,
)
from app.services.agent.chat import recover_completion, resume_completion, stream_completion
from app.services.agent.context import _token_calibration, latest_checkpoint
from app.services.agent.preparation import iter_prepare_completion
from app.services.agent.prompts import COMPACTION_INSTRUCTIONS
from app.services.agent.runs import append_event, start_run
from app.services.agent.tokens import request_tokens
from app.services.agent.tool_results import read_tool_result
from app.services.errors import ServiceError
from app.services.model_credentials import encrypt_api_key
from app.services.settings.background_tasks import background_task_settings

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "inspect",
            "description": "Inspect a resource",
            "parameters": {"type": "object", "properties": {}},
        },
    }
]


@pytest.fixture
def workspace(monkeypatch):
    app = create_app("testing")
    with app.app_context():
        db.create_all()
        user = User(email="compaction@example.com", display_name="Context", password_hash="unused")
        db.session.add(user)
        db.session.flush()
        project = Project(
            user_id=user.id, device_id="test", device_name="Test", name="Repo", path="/repo"
        )
        db.session.add(project)
        db.session.flush()
        conversation = Conversation(project_id=project.id)
        model = ModelConfiguration(
            user_id=user.id,
            name="Test",
            base_url="https://example.com/v1",
            model="test-model",
            api_key_encrypted=encrypt_api_key("test-key"),
            context_length=4096,
        )
        db.session.add_all([conversation, model])
        db.session.flush()
        message = Message(
            conversation=conversation, role="user", content="Keep the public API stable."
        )
        db.session.add(message)
        db.session.commit()
        run = start_run(conversation.id, model, tool_snapshot=TOOLS)
        summaries = []

        def summarize(_model, content, *, max_tokens):
            summaries.append((content, max_tokens))
            return (
                "Preserve the public API. Earlier inspection completed; "
                "retrieve originals by resultRef."
            )

        monkeypatch.setattr("app.services.agent.context._summary_request", summarize)
        yield SimpleNamespace(
            user=user,
            project=project,
            conversation=conversation,
            model=model,
            message=message,
            run=run,
            summaries=summaries,
        )


def add_batch(run, call_id, output, *, calls=1):
    identifiers = [f"{call_id}-{index}" for index in range(calls)]
    append_event(
        run,
        "tool.requested",
        {
            "content": "Checking the relevant implementation",
            "toolCalls": [
                {
                    "id": identifier,
                    "type": "function",
                    "function": {"name": "inspect", "arguments": "{}"},
                }
                for identifier in identifiers
            ],
        },
    )
    event = append_event(
        run,
        "tool.output",
        {
            "results": [
                {"callId": identifier, "result": {"output": output}} for identifier in identifiers
            ]
        },
    )
    db.session.commit()
    return event.sequence


def consume(iterator):
    events = []
    while True:
        try:
            events.append(next(iterator))
        except StopIteration as done:
            return events, done.value


def prepare(workspace, **kwargs):
    return consume(
        iter_prepare_completion(
            workspace.run.id,
            "",
            TOOLS,
            system_instructions="Follow the user's requirements.",
            **kwargs,
        )
    )


def test_single_turn_compacts_whole_batches_and_can_compact_again(workspace):
    w = workspace
    for index in range(5):
        add_batch(w.run, f"old-{index}", "old evidence " * 1000, calls=2)
    iterator = iter_prepare_completion(w.run.id, "", TOOLS, system_instructions="Rules")
    assert next(iterator)["type"] == "context.compaction.started"
    assert w.summaries == []  # The UI sees the status before the summary request starts.
    events, prepared = consume(iterator)
    assert events[-1]["type"] == "context.compaction.completed"
    checkpoint = latest_checkpoint(w.conversation.id)
    assert checkpoint.covered_run_id == w.run.id
    assert checkpoint.covered_message_id is None
    first_cursor = checkpoint.covered_event_sequence
    tool_calls = [
        call["id"]
        for message in prepared.payload["messages"]
        for call in message.get("tool_calls", [])
    ]
    results = [
        message["tool_call_id"]
        for message in prepared.payload["messages"]
        if message["role"] == "tool"
    ]
    assert tool_calls == results == ["old-4-0", "old-4-1"]
    assert any(message["content"] == w.message.content for message in prepared.payload["messages"])
    assert request_tokens(prepared.payload["messages"], TOOLS) < w.model.context_length
    assert read_tool_result(w.user.id, w.run.id, "old-0-0")["content"].startswith("old evidence")

    for index in range(5):
        add_batch(w.run, f"new-{index}", "new evidence " * 1000)
    _, prepared = prepare(w)
    assert latest_checkpoint(w.conversation.id).covered_event_sequence > first_cursor
    assert "PREVIOUS CHECKPOINT:\nPreserve the public API" in w.summaries[-1][0]
    assert '"id": "old-0-0"' not in w.summaries[-1][0]
    assert [
        message["tool_call_id"]
        for message in prepared.payload["messages"]
        if message["role"] == "tool"
    ] == ["new-4-0"]


def test_checkpoint_does_not_reintroduce_compacted_events_in_next_turn(workspace):
    w = workspace
    for index in range(5):
        add_batch(w.run, f"batch-{index}", "evidence " * 1500)
    prepare(w)
    w.run.status = "completed"
    w.run.completed_at = datetime.now(UTC)
    db.session.add(
        Message(
            conversation=w.conversation, agent_run_id=w.run.id, role="assistant", content="Done"
        )
    )
    db.session.add(Message(conversation=w.conversation, role="user", content="Explain the result"))
    db.session.commit()
    w.model.context_length = 100_000
    next_run = start_run(w.conversation.id, w.model)
    _, prepared = consume(iter_prepare_completion(next_run.id, "", [], system_instructions="Rules"))
    content = json.dumps(prepared.payload["messages"])
    assert "batch-0-0" not in content
    assert "batch-4-0" in content
    assert "Explain the result" in content


def test_recent_completed_turns_are_compactable_when_the_budget_requires_it(workspace):
    w = workspace
    w.run.status = "completed"
    w.run.completed_at = datetime.now(UTC)
    add_batch(w.run, "completed", "evidence " * 2000)
    assistant = Message(
        conversation=w.conversation, agent_run_id=w.run.id, role="assistant", content="Done"
    )
    db.session.add(assistant)
    db.session.add(Message(conversation=w.conversation, role="user", content="Continue"))
    db.session.commit()
    next_run = start_run(w.conversation.id, w.model)
    events, prepared = consume(
        iter_prepare_completion(next_run.id, "", TOOLS, system_instructions="Rules")
    )
    assert events[0]["type"] == "context.compaction.started"
    assert latest_checkpoint(w.conversation.id).covered_message_id == assistant.id
    assert prepared.payload["messages"][-1]["content"] == "Continue"


def test_tools_and_workspace_instructions_participate_in_the_budget(workspace):
    w = workspace
    add_batch(w.run, "small", "result")
    tools = [{**TOOLS[0], "function": {**TOOLS[0]["function"], "description": "schema " * 1000}}]
    with pytest.raises(ServiceError, match="context_budget_exceeded"):
        consume(
            iter_prepare_completion(
                w.run.id, "workspace " * 2000, tools, system_instructions="Rules"
            )
        )
    assert w.run.status == "failed"
    assert w.summaries == []


def test_usage_uses_input_tokens_and_calibrates_estimates(workspace, monkeypatch):
    w = workspace
    _, prepared = prepare(w)

    def provider(_prepared):
        yield {"choices": [{"delta": {"content": "Done"}}]}
        yield {
            "choices": [],
            "usage": {
                "prompt_tokens": prepared.estimated_input_tokens * 2,
                "completion_tokens": 17,
                "total_tokens": 9999,
            },
        }

    monkeypatch.setattr("app.services.agent.chat.provider_payloads", provider)
    events = list(stream_completion(prepared))
    usage = next(event for event in events if event["type"] == "context.usage")
    assert usage["usedTokens"] == prepared.estimated_input_tokens * 2
    assert _token_calibration(w.model) == 2
    assert w.run.output_tokens == 17
    other = ModelConfiguration(
        user_id=w.user.id,
        name="Other",
        model="other",
        base_url="https://example.com",
        api_key_encrypted=encrypt_api_key("other"),
    )
    db.session.add(other)
    db.session.flush()
    assert _token_calibration(other) == 1


@pytest.mark.parametrize("path", ["resume", "recover"])
def test_resume_and_recovery_stream_compaction_status(workspace, monkeypatch, path):
    w = workspace
    for index in range(5):
        add_batch(w.run, f"batch-{index}", "evidence " * 1000)
    if path == "resume":
        append_event(
            w.run,
            "tool.requested",
            {
                "toolCalls": [
                    {
                        "id": "last",
                        "type": "function",
                        "function": {"name": "inspect", "arguments": "{}"},
                    }
                ]
            },
        )
        w.run.status = "waiting_tool"
        db.session.commit()
        preparation = resume_completion(
            w.user.id,
            w.run.id,
            [{"callId": "last", "result": "ok"}],
            tool_snapshot=TOOLS,
            system_instructions="Rules",
        )
    else:
        w.run.status = "failed"
        w.run.error_code = "client_disconnected"
        db.session.commit()
        preparation = recover_completion(
            w.user.id,
            w.run.id,
            partial_content="Partial response",
            tool_snapshot=TOOLS,
            system_instructions="Rules",
        )
    seen = []

    def provider(prepared):
        seen.append(prepared.payload)
        yield {"choices": [{"delta": {"content": "Done"}}]}

    monkeypatch.setattr("app.services.agent.chat.provider_payloads", provider)
    stream = stream_completion(preparation)
    assert next(stream)["type"] == "context.compaction.started"
    assert seen == []
    events = list(stream)
    assert any(event["type"] == "context.compaction.completed" for event in events)
    if path == "recover":
        assert "Partial response" in json.dumps(seen[0]["messages"])


def test_compaction_failure_preserves_events_and_does_not_publish_a_checkpoint(
    workspace, monkeypatch
):
    w = workspace
    for index in range(5):
        add_batch(w.run, f"batch-{index}", "evidence " * 1000)
    original_outputs = [event.id for event in w.run.events if event.event_type == "tool.output"]

    def fail(*args, **kwargs):
        raise httpx.ReadTimeout("summary provider unavailable")

    monkeypatch.setattr("app.services.agent.context._summary_request", fail)
    events = list(
        stream_completion(iter_prepare_completion(w.run.id, "", TOOLS, system_instructions="Rules"))
    )
    assert events[-1] == {"type": "run.failed", "errorCode": "context_compaction_failed"}
    assert db.session.scalar(db.select(ContextCheckpoint)) is None
    assert [
        event.id for event in w.run.events if event.event_type == "tool.output"
    ] == original_outputs
    assert w.run.status == "failed"


def test_group_chat_uses_the_same_budget_and_advances_its_own_cursor(workspace):
    w = workspace
    agent = MultiAgent(user_id=w.user.id, name="Team")
    db.session.add(agent)
    db.session.flush()
    task = MultiAgentTask(
        agent_id=agent.id, project_id=w.project.id, title="Task", request="Review"
    )
    db.session.add(task)
    db.session.flush()
    node = MultiAgentNode(
        task_id=task.id,
        conversation_id=w.conversation.id,
        key="host",
        name="Host",
        role="Host",
        instructions="Coordinate",
    )
    db.session.add(node)
    db.session.flush()
    for sequence in range(1, 6):
        db.session.add(
            MultiAgentMessage(
                task_id=task.id,
                sequence=sequence,
                from_node_id=node.id,
                content=f"message-{sequence} " * 800 if sequence < 5 else "latest-group-message",
            )
        )
    db.session.commit()
    events, prepared = prepare(w)
    assert events[0]["type"] == "context.compaction.started"
    assert latest_checkpoint(w.conversation.id).state["mailboxSequence"] == 4
    assert "latest-group-message" in json.dumps(prepared.payload["messages"])
    assert (
        len(
            [
                item
                for item in prepared.payload["messages"]
                if "Collaboration group chat" in str(item["content"])
            ]
        )
        == 1
    )
    db.session.add(MultiAgentMessage(task_id=task.id, sequence=6, content="new-group-message"))
    db.session.commit()
    _, prepared = prepare(w)
    assert "new-group-message" in json.dumps(prepared.payload["messages"])
    assert "message-1" not in json.dumps(prepared.payload["messages"])


def test_threshold_comes_from_user_configuration(workspace):
    w = workspace
    add_batch(w.run, "one", "evidence " * 300)
    add_batch(w.run, "two", "evidence " * 100)
    db.session.add(
        Message(
            conversation=w.conversation,
            role="assistant",
            content="historical evidence " * 250,
            created_at=w.message.created_at - timedelta(seconds=1),
        )
    )
    settings = background_task_settings(w.user.id)
    settings.context_compaction_ratio = 0.9
    db.session.commit()
    assert prepare(w)[0] == []
    settings.context_compaction_ratio = 0.2
    db.session.commit()
    assert prepare(w)[0][0]["type"] == "context.compaction.started"


def test_summary_pages_fit_a_smaller_configured_summary_model(workspace, monkeypatch):
    w = workspace
    summary_model = ModelConfiguration(
        user_id=w.user.id,
        name="Summary",
        model="summary-model",
        base_url="https://example.com/v1",
        api_key_encrypted=encrypt_api_key("summary"),
        context_length=768,
    )
    db.session.add(summary_model)
    db.session.flush()
    background_task_settings(w.user.id).context_compaction_model_id = summary_model.id
    for index in range(5):
        add_batch(w.run, f"batch-{index}", "evidence " * 1000)
    calls = []

    def summarize(model, content, *, max_tokens):
        assert model.id == summary_model.id
        assert (
            request_tokens(
                [
                    {"role": "system", "content": COMPACTION_INSTRUCTIONS},
                    {"role": "user", "content": content},
                ],
                [],
            )
            + max_tokens
            <= model.context_length
        )
        calls.append(content)
        return "Keep the public API stable. Inspection completed."

    monkeypatch.setattr("app.services.agent.context._summary_request", summarize)
    events, _ = prepare(w)
    assert len(calls) > 1
    assert events[-1]["type"] == "context.compaction.completed"
