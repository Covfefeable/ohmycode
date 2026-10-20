import copy
import json
from importlib import import_module
from types import SimpleNamespace

import httpx
import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from flask_jwt_extended import create_access_token
from openai import APIStatusError
from sqlalchemy import create_engine, inspect

from app import create_app
from app.extensions import db
from app.models import AgentRun, Conversation, ModelExecution, Project, User
from app.services.agent.provider_stream import PreparedCompletion, provider_payloads
from app.services.agent.request_snapshots import record_request, record_request_usage


@pytest.fixture
def workspace():
    app = create_app("testing")
    with app.app_context():
        db.create_all()
        user = User(email="snapshot@example.com", display_name="Test", password_hash="unused")
        db.session.add(user)
        db.session.flush()
        project = Project(
            user_id=user.id, device_id="device-a", device_name="Test", path="/repo", name="Repo"
        )
        db.session.add(project)
        db.session.flush()
        conversation = Conversation(project_id=project.id, title="Context test")
        db.session.add(conversation)
        db.session.flush()
        run = AgentRun(conversation_id=conversation.id)
        db.session.add(run)
        db.session.flush()
        execution = ModelExecution(run_id=run.id, request_key="initial", parameters={})
        db.session.add(execution)
        db.session.commit()
        prepared = PreparedCompletion(
            run.id,
            conversation.id,
            "https://provider.example/v1/chat/completions",
            "secret-provider-key",
            4096,
            {},
            300,
            execution.id,
        )
        yield SimpleNamespace(
            app=app,
            user=user,
            conversation=conversation,
            run=run,
            execution=execution,
            prepared=prepared,
        )


def test_snapshot_keeps_exact_text_and_schema_but_not_encoded_images_or_credentials(workspace):
    w = workspace
    payload = {
        "model": "old-model",
        "messages": [
            {"role": "system", "content": "Exact instructions"},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": "data:image/png;base64,private-image-bytes"},
                    }
                ],
            },
        ],
        "tools": [{"type": "function", "function": {"name": "read_file"}}],
    }
    original = copy.deepcopy(payload)
    record_request(w.prepared, payload)
    snapshot = w.execution.request_snapshot
    assert snapshot["body"]["model"] == "old-model"
    assert snapshot["body"]["messages"][0] == payload["messages"][0]
    assert snapshot["body"]["tools"] == payload["tools"]
    assert snapshot["messageCount"] == 2
    assert snapshot["toolCount"] == 1
    assert snapshot["estimatedTokens"] == 300
    assert "private-image-bytes" not in json.dumps(snapshot)
    assert "secret-provider-key" not in json.dumps(snapshot)
    assert payload == original


def test_only_latest_request_is_retained_and_usage_does_not_resurrect_older_snapshot(workspace):
    w = workspace
    record_request(w.prepared, {"model": "first", "messages": []})
    first_id = w.execution.id
    next_execution = ModelExecution(run_id=w.run.id, request_key="next", step=1, parameters={})
    db.session.add(next_execution)
    db.session.commit()
    w.prepared = PreparedCompletion(
        w.run.id,
        w.conversation.id,
        "https://provider.example/v1/chat/completions",
        "secret",
        4096,
        {},
        200,
        next_execution.id,
    )
    record_request(w.prepared, {"model": "second", "messages": []})
    record_request_usage(first_id, {"prompt_tokens": 9999})
    record_request_usage(
        next_execution.id, {"prompt_tokens": 220, "prompt_tokens_details": {"cached_tokens": 128}}
    )
    db.session.expire_all()
    assert db.session.get(ModelExecution, first_id).request_snapshot is None
    assert (
        db.session.scalar(
            db.select(db.func.count())
            .select_from(ModelExecution)
            .where(ModelExecution.request_snapshot.is_not(None))
        )
        == 1
    )
    snapshot = db.session.get(ModelExecution, next_execution.id).request_snapshot
    assert snapshot["body"]["model"] == "second"
    assert snapshot["usage"]["prompt_tokens_details"]["cached_tokens"] == 128


def test_snapshot_endpoint_is_read_only_and_checks_owner_and_device(workspace, monkeypatch):
    w = workspace
    token = create_access_token(identity=str(w.user.id))
    headers = {
        "Authorization": f"Bearer {token}",
        "X-OhMyCode-Device-Id": "device-a",
        "X-OhMyCode-Device-Name": "Test",
    }
    url = f"/api/projects/conversations/{w.conversation.id}/context-snapshot"
    client = w.app.test_client()
    assert client.get(url, headers=headers).json["snapshot"] is None
    record_request(w.prepared, {"model": "request-model", "messages": []})
    monkeypatch.setattr(
        "app.services.agent.execution_worker.execute_execution",
        lambda _: pytest.fail("Reading ran model"),
    )
    before = db.session.scalar(db.select(db.func.count()).select_from(ModelExecution))
    assert client.get(url, headers=headers).json["snapshot"]["body"]["model"] == "request-model"
    assert db.session.scalar(db.select(db.func.count()).select_from(ModelExecution)) == before
    assert (
        client.get(url, headers={**headers, "X-OhMyCode-Device-Id": "other-device"}).status_code
        == 404
    )
    outsider = User(email="other@example.com", display_name="Other", password_hash="unused")
    db.session.add(outsider)
    db.session.commit()
    other_token = create_access_token(identity=str(outsider.id))
    assert (
        client.get(url, headers={**headers, "Authorization": f"Bearer {other_token}"}).status_code
        == 404
    )
    assert client.get(url).status_code == 401


def test_provider_fallback_captures_actual_body_and_usage(workspace, monkeypatch):
    w = workspace
    payload = {
        "model": "actual-model",
        "messages": [{"role": "user", "content": "hello"}],
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    object.__setattr__(w.prepared, "payload", payload)
    calls = []

    def create(**body):
        calls.append(body)
        if len(calls) == 1:
            raise APIStatusError(
                "Unsupported stream_options",
                response=httpx.Response(400, request=httpx.Request("POST", w.prepared.endpoint)),
                body={},
            )
        return iter([{"usage": {"prompt_tokens": 123, "completion_tokens": 2}}])

    class Client:
        def __init__(self, **kwargs):
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=create))

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    monkeypatch.setattr("app.services.agent.provider_stream.OpenAI", Client)
    assert list(provider_payloads(w.prepared))[0]["usage"]["prompt_tokens"] == 123
    snapshot = db.session.get(ModelExecution, w.execution.id).request_snapshot
    assert snapshot["body"] == calls[-1]
    assert "stream_options" not in snapshot["body"]
    assert "stream_options" in payload
    assert snapshot["usage"]["prompt_tokens"] == 123


def test_snapshot_migration_upgrade_and_downgrade():
    migration = import_module("migrations.versions.d81vz576xt95_add_request_snapshot")
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE model_executions (id INTEGER PRIMARY KEY)")
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            assert "request_snapshot" in {
                column["name"] for column in inspect(connection).get_columns("model_executions")
            }
            migration.downgrade()
            assert "request_snapshot" not in {
                column["name"] for column in inspect(connection).get_columns("model_executions")
            }
