import uuid
from datetime import UTC, datetime

import pytest

from app import create_app
from app.extensions import db
from app.models import AgentEvent, AgentRun, Conversation, Message
from app.services.agent.context_history import (
    _render_messages,
    history_runs,
    project_context_snapshot,
)
from app.services.agent.tool_results import read_tool_result
from app.services.errors import ServiceError


def test_branch_deep_copies_messages_without_usage_or_runtime_state():
    app = create_app("testing")
    with app.app_context():
        db.create_all()

    with app.test_client() as client:
        registration = client.post(
            "/api/auth/register",
            json={
                "email": "branch@example.com",
                "displayName": "Branch User",
                "password": "secret123",
            },
        ).get_json()
        headers = {
            "Authorization": f"Bearer {registration['tokens']['accessToken']}",
            "X-OhMyCode-Device-Id": "device-a",
            "X-OhMyCode-Device-Name": "Desktop%20A",
        }
        project = client.post(
            "/api/projects",
            headers=headers,
            json={"name": "workspace", "path": "C:/repos/workspace"},
        ).get_json()
        source = client.post(
            f"/api/projects/{project['id']}/conversations",
            headers=headers,
            json={"title": "Original"},
        ).get_json()
        first = client.post(
            f"/api/projects/conversations/{source['id']}/messages",
            headers=headers,
            json={"role": "user", "content": "First"},
        ).get_json()
        second = client.post(
            f"/api/projects/conversations/{source['id']}/messages",
            headers=headers,
            json={"role": "assistant", "content": "Second"},
        ).get_json()
        client.post(
            f"/api/projects/conversations/{source['id']}/messages",
            headers=headers,
            json={"role": "user", "content": "Excluded"},
        )

        with app.app_context():
            source_id = uuid.UUID(source["id"])
            run = AgentRun(
                conversation_id=source_id,
                status="completed",
                completed_at=datetime.now(UTC),
                input_tokens=120,
                output_tokens=30,
            )
            db.session.add(run)
            db.session.flush()
            db.session.add(
                AgentEvent(
                    run=run,
                    sequence=1,
                    event_type="context.usage",
                    payload={"usedTokens": 150, "contextLength": 4096},
                )
            )
            source_message = db.session.get(Message, uuid.UUID(second["id"]))
            db.session.add(
                AgentEvent(
                    run=run,
                    sequence=2,
                    event_type="reasoning.completed",
                    payload={"content": "Independent reasoning"},
                )
            )
            source_message.agent_run_id = run.id
            db.session.add(
                AgentEvent(
                    run=run,
                    sequence=3,
                    event_type="tool.output",
                    payload={
                        "results": [{"callId": "evidence", "result": {"output": "branch evidence"}}]
                    },
                )
            )
            source_message.reasoning = "Independent reasoning"
            source_message.activity = [{"type": "message", "content": "Second"}]
            source_message.attachments = [
                {
                    "id": "attachment-1",
                    "name": "notes.md",
                    "path": "C:/repos/workspace/notes.md",
                    "size": 12,
                    "mimeType": "text/markdown",
                }
            ]
            db.session.commit()
            source_run_id = run.id

        response = client.post(
            f"/api/projects/conversations/{source['id']}/branch",
            headers=headers,
            json={"messageId": second["id"]},
        )

        assert response.status_code == 201
        branch = response.get_json()
        assert branch["title"] == "First 分支"
        assert branch["contextUsage"] is None
        assert [message["content"] for message in branch["messages"]] == ["First", "Second"]
        assert {message["id"] for message in branch["messages"]}.isdisjoint(
            {first["id"], second["id"]}
        )
        assert branch["messages"][1]["reasoning"] == "Independent reasoning"
        assert branch["messages"][1]["activity"] == [{"type": "message", "content": "Second"}]
        assert branch["messages"][1]["attachments"][0]["name"] == "notes.md"
        source_detail = client.get(
            f"/api/projects/conversations/{source['id']}", headers=headers
        ).get_json()
        assert source_detail["contextUsage"]["usedTokens"] == 150
        usage = client.get("/api/settings", headers=headers).get_json()["tokenUsage"]
        assert sum(day["tokens"] for day in usage) == 150

        with app.app_context():
            copied = db.session.get(Conversation, uuid.UUID(branch["id"]))
            assert all(message.agent_run_id is None for message in copied.messages)
            assert (
                db.session.scalar(
                    db.select(db.func.count(AgentRun.id)).where(
                        AgentRun.conversation_id == copied.id
                    )
                )
                == 0
            )
            snapshot = copied.messages[1].context_snapshot
            assert snapshot and "Complete AgentEvent history" in snapshot[0]["content"]
            assert '"usedTokens"' not in snapshot[0]["content"]
            rendered = _render_messages(copied.messages, set(), history_runs(copied.messages))
            projected = project_context_snapshot(snapshot)
            assert projected[0] in rendered
            assert "Independent reasoning" not in str(rendered)
            assert "branch evidence" in str(rendered)

        # A branch's model context remains usable after removing its source.
        assert (
            client.delete(
                f"/api/projects/conversations/{source['id']}", headers=headers
            ).status_code
            == 204
        )
        with app.app_context():
            copied = db.session.get(Conversation, uuid.UUID(branch["id"]))
            assert projected[0] in _render_messages(
                copied.messages, set(), history_runs(copied.messages)
            )
            assert (
                read_tool_result(copied.project.user_id, source_run_id, "evidence")["content"]
                == "branch evidence"
            )
            with pytest.raises(ServiceError) as error:
                read_tool_result(uuid.uuid4(), source_run_id, "evidence")
            assert error.value.code == "not_found"

        endpoint = f"/api/agent-runs/{source_run_id}/tool-results/evidence"
        response = client.post(f"{endpoint}/read", headers=headers, json={})
        assert response.status_code == 200
        assert response.get_json()["content"] == "branch evidence"
        assert (
            client.post(
                f"{endpoint}/search", headers=headers, json={"query": "evidence"}
            ).status_code
            == 200
        )
        other_device = {**headers, "X-OhMyCode-Device-Id": "other-device"}
        assert client.post(f"{endpoint}/read", headers=other_device, json={}).status_code == 404
        assert (
            client.post(
                f"{endpoint}/search", headers=other_device, json={"query": "evidence"}
            ).status_code
            == 404
        )
        mobile_endpoint = f"/api/mobile/conversations/runs/{source_run_id}/tool-results/evidence"
        assert client.post(f"{mobile_endpoint}/read", headers=headers, json={}).status_code == 404
        assert (
            client.post(
                f"{mobile_endpoint}/search", headers=headers, json={"query": "evidence"}
            ).status_code
            == 404
        )


def test_branch_rejects_a_message_from_another_conversation():
    app = create_app("testing")
    with app.app_context():
        db.create_all()

    with app.test_client() as client:
        registration = client.post(
            "/api/auth/register",
            json={
                "email": "branch-scope@example.com",
                "displayName": "Branch Scope",
                "password": "secret123",
            },
        ).get_json()
        headers = {
            "Authorization": f"Bearer {registration['tokens']['accessToken']}",
            "X-OhMyCode-Device-Id": "device-a",
            "X-OhMyCode-Device-Name": "Desktop%20A",
        }
        project = client.post(
            "/api/projects",
            headers=headers,
            json={"name": "workspace", "path": "C:/repos/branch-scope"},
        ).get_json()
        conversations = [
            client.post(
                f"/api/projects/{project['id']}/conversations",
                headers=headers,
                json={"title": title},
            ).get_json()
            for title in ("First", "Second")
        ]
        foreign_message = client.post(
            f"/api/projects/conversations/{conversations[1]['id']}/messages",
            headers=headers,
            json={"role": "user", "content": "Not part of the source"},
        ).get_json()

        response = client.post(
            f"/api/projects/conversations/{conversations[0]['id']}/branch",
            headers=headers,
            json={"messageId": foreign_message["id"]},
        )

        assert response.status_code == 404
