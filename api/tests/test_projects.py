import json
import uuid

import httpx

from app import create_app
from app.extensions import db
from app.models import AgentRun, Project, User

DESKTOP_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "terminal",
            "description": "Terminal tool",
            "parameters": {"type": "object", "properties": {}},
        },
    }
]


def test_projects_and_conversations_are_isolated_by_device():
    app = create_app("testing")
    with app.app_context():
        db.create_all()

    with app.test_client() as client:
        registration = client.post(
            "/api/auth/register",
            json={
                "email": "devices@example.com",
                "displayName": "Devices User",
                "password": "secret123",
            },
        )
        authorization = f"Bearer {registration.get_json()['tokens']['accessToken']}"
        first_headers = {
            "Authorization": authorization,
            "X-OhMyCode-Device-Id": "device-a",
            "X-OhMyCode-Device-Name": "Desktop%20A",
        }
        second_headers = {
            "Authorization": authorization,
            "X-OhMyCode-Device-Id": "device-b",
            "X-OhMyCode-Device-Name": "Desktop%20B",
        }

        first = client.post(
            "/api/projects",
            headers=first_headers,
            json={"name": "shared-name", "path": "C:/repos/shared"},
        ).get_json()
        second = client.post(
            "/api/projects",
            headers=second_headers,
            json={"name": "shared-name", "path": "C:/repos/shared"},
        ).get_json()
        conversation = client.post(
            f"/api/projects/{first['id']}/conversations",
            headers=first_headers,
            json={"title": "Device A chat"},
        ).get_json()

        assert first["id"] != second["id"]
        assert [
            item["id"] for item in client.get("/api/projects", headers=first_headers).get_json()
        ] == [first["id"]]
        assert [
            item["id"] for item in client.get("/api/projects", headers=second_headers).get_json()
        ] == [second["id"]]
        assert (
            client.get(
                f"/api/projects/conversations/{conversation['id']}", headers=second_headers
            ).status_code
            == 404
        )


def test_hidden_multi_agent_project_is_promoted_to_workspace():
    app = create_app("testing")
    with app.app_context():
        db.create_all()

    with app.test_client() as client:
        registration = client.post(
            "/api/auth/register",
            json={
                "email": "promotion@example.com",
                "displayName": "Promotion User",
                "password": "secret123",
            },
        )
        headers = {
            "Authorization": f"Bearer {registration.get_json()['tokens']['accessToken']}",
            "X-OhMyCode-Device-Id": "device-a",
            "X-OhMyCode-Device-Name": "Test%20device",
        }
        with app.app_context():
            user = db.session.scalar(db.select(User).where(User.email == "promotion@example.com"))
            hidden = Project(
                user_id=user.id,
                device_id="device-a",
                device_name="Test device",
                name="hidden-run",
                path="C:/Users/admin/Desktop",
                kind="multi_agent",
            )
            db.session.add(hidden)
            db.session.commit()
            hidden_id = str(hidden.id)

        created = client.post(
            "/api/projects",
            headers=headers,
            json={"name": "Desktop", "path": "C:/Users/admin/Desktop"},
        )

        assert created.status_code == 201
        assert created.get_json()["id"] == hidden_id
        assert any(
            project["id"] == hidden_id
            for project in client.get("/api/projects", headers=headers).get_json()
        )


def test_project_conversation_and_message_lifecycle(monkeypatch):
    app = create_app("testing")
    with app.app_context():
        db.create_all()

    with app.test_client() as client:
        registration = client.post(
            "/api/auth/register",
            json={
                "email": "projects@example.com",
                "displayName": "Project User",
                "password": "secret123",
            },
        )
        token = registration.get_json()["tokens"]["accessToken"]
        headers = {
            "Authorization": f"Bearer {token}",
            "X-OhMyCode-Device-Id": "device-a",
            "X-OhMyCode-Device-Name": "Test%20device",
        }

        model_id = str(uuid.uuid4())
        saved_settings = client.put(
            "/api/settings/models",
            headers=headers,
            json={
                "models": [
                    {
                        "id": model_id,
                        "name": "Default",
                        "baseUrl": "https://example.com/v1",
                        "model": "example-model",
                        "apiKey": "server-only-secret",
                    }
                ]
            },
        )
        assert saved_settings.status_code == 204
        public_settings = client.get("/api/settings", headers=headers).get_json()
        assert public_settings["models"][0]["id"] == model_id
        assert public_settings["models"][0]["hasApiKey"] is True
        assert public_settings["models"][0]["contextLength"] == 262_144
        assert "apiKey" not in public_settings["models"][0]

        created = client.post(
            "/api/projects",
            headers=headers,
            json={"name": "ohmycode", "path": "C:/repos/ohmycode"},
        )
        assert created.status_code == 201
        project_id = created.get_json()["id"]
        assert (
            client.post(
                "/api/projects",
                headers=headers,
                json={"name": "ohmycode", "path": "C:/repos/ohmycode"},
            ).status_code
            == 409
        )

        conversation = client.post(
            f"/api/projects/{project_id}/conversations",
            headers=headers,
            json={"title": "New conversation"},
        )
        assert conversation.status_code == 201
        conversation_id = conversation.get_json()["id"]

        message = client.post(
            f"/api/projects/conversations/{conversation_id}/messages",
            headers=headers,
            json={"role": "user", "content": "Build a Flask route"},
        )
        assert message.status_code == 201
        message_id = message.get_json()["id"]
        assert (
            client.post(
                f"/api/projects/conversations/{conversation_id}/messages",
                headers=headers,
                json={"role": "assistant", "content": "Here is the route."},
            ).status_code
            == 201
        )

        edited = client.patch(
            f"/api/projects/conversations/{conversation_id}/messages/{message_id}",
            headers=headers,
            json={"content": "Build a streaming Flask route"},
        )
        assert edited.status_code == 200
        assert len(edited.get_json()["messages"]) == 1

        detail = client.get(
            f"/api/projects/conversations/{conversation_id}", headers=headers
        ).get_json()
        assert detail["title"] == "Build a streaming Flask route"
        assert detail["messages"][0]["content"] == "Build a streaming Flask route"

        projects = client.get("/api/projects", headers=headers).get_json()
        assert projects[0]["conversations"][0]["id"] == conversation_id

        class ProviderResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def raise_for_status(self):
                return None

            def iter_lines(self):
                return iter(
                    [
                        'data: {"choices":[{"delta":{"reasoning_content":"Checking context"}}]}',
                        'data: {"choices":[{"delta":{"content":"Hello "}}]}',
                        'data: {"choices":[{"delta":{"content":"stream"}}]}',
                        'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":30}}',
                        "data: [DONE]",
                    ]
                )

        class EmptyProviderResponse(ProviderResponse):
            def iter_lines(self):
                return iter(['data: {"choices":[]}', "data: [DONE]"])

        provider_responses = iter([EmptyProviderResponse(), ProviderResponse()])
        provider_payloads = []

        def provider_stream(*_args, **kwargs):
            provider_payloads.append(kwargs["json"])
            return next(provider_responses)

        monkeypatch.setattr(
            "app.services.agent.provider_stream.httpx.stream",
            provider_stream,
        )
        requested_turn_id = str(uuid.uuid4())
        streamed = client.post(
            f"/api/projects/conversations/{conversation_id}/stream",
            headers=headers,
            json={
                "content": "Continue",
                "modelId": model_id,
                "turnId": requested_turn_id,
                "tools": DESKTOP_TOOLS,
                "attachments": [
                    {
                        "id": "attachment-1",
                        "name": "architecture.md",
                        "path": "C:/repos/ohmycode/docs/architecture.md",
                        "size": 2048,
                        "mimeType": "text/markdown",
                    }
                ],
            },
        )
        assert streamed.status_code == 200
        assert f'"runId": "{requested_turn_id}"'.encode() in streamed.data
        assert b'"type": "reasoning.delta"' in streamed.data
        assert b'"content": "Hello "' in streamed.data
        assert b'"content": "stream"' in streamed.data
        final_detail = client.get(
            f"/api/projects/conversations/{conversation_id}", headers=headers
        ).get_json()
        assert final_detail["messages"][-1]["content"] == "Hello stream"
        assert final_detail["messages"][-1]["reasoning"] == "Checking context"
        assert final_detail["messages"][-1]["agentDurationMs"] is not None
        assert final_detail["contextUsage"] == {
            "usedTokens": 120,
            "contextLength": 262_144,
            "source": "provider",
        }
        sent_message = final_detail["messages"][-2]
        assert sent_message["attachments"][0]["name"] == "architecture.md"
        user_context = provider_payloads[-1]["messages"][-1]["content"]
        assert "architecture.md" in user_context
        assert "C:/repos/ohmycode/docs/architecture.md" in user_context
        usage = client.get("/api/settings", headers=headers).get_json()["tokenUsage"]
        assert sum(day["tokens"] for day in usage) == 150

        failed_conversation = client.post(
            f"/api/projects/{project_id}/conversations",
            headers=headers,
            json={"title": "Failed provider stream"},
        ).get_json()

        def missing_provider(*_args, **_kwargs):
            raise FileNotFoundError("provider dependency disappeared")

        monkeypatch.setattr("app.services.agent.provider_stream.httpx.stream", missing_provider)
        failed_stream = client.post(
            f"/api/projects/conversations/{failed_conversation['id']}/stream",
            headers=headers,
            json={"content": "Continue", "modelId": model_id, "tools": DESKTOP_TOOLS},
        )
        failed_body = failed_stream.get_data(as_text=True)
        assert '"type": "run.failed"' in failed_body
        assert '"errorCode": "FileNotFoundError"' in failed_body
        assert failed_body.endswith("data: [DONE]\n\n")

        with app.app_context():
            disconnected_run = db.session.scalar(
                db.select(AgentRun)
                .where(AgentRun.conversation_id == uuid.UUID(failed_conversation["id"]))
                .order_by(AgentRun.started_at.desc())
            )
            disconnected_run.error_code = "client_disconnected"
            db.session.commit()
            disconnected_run_id = str(disconnected_run.id)

        recovery_payloads = []

        def recovery_stream(*_args, **kwargs):
            recovery_payloads.append(kwargs["json"])
            return ProviderResponse()

        monkeypatch.setattr("app.services.agent.provider_stream.httpx.stream", recovery_stream)
        recovered = client.post(
            f"/api/agent-runs/{disconnected_run_id}/recover",
            headers=headers,
            json={
                "partialContent": "Partial ",
                "partialReasoning": "Initial thought",
                "tools": DESKTOP_TOOLS,
            },
        )
        assert b'"content": "Hello "' in recovered.data
        recovered_detail = client.get(
            f"/api/projects/conversations/{failed_conversation['id']}", headers=headers
        ).get_json()
        assert recovered_detail["messages"][-1]["content"] == "Partial Hello stream"
        assert recovery_payloads[-1]["messages"][-2]["content"] == "Partial "

        balance_conversation = client.post(
            f"/api/projects/{project_id}/conversations",
            headers=headers,
            json={"title": "Provider balance failure"},
        ).get_json()

        def insufficient_balance(*_args, **_kwargs):
            request = httpx.Request("POST", "https://example.com/chat/completions")
            response = httpx.Response(
                402,
                request=request,
                json={
                    "error": {
                        "message": "Insufficient Balance",
                        "code": "invalid_request_error",
                    }
                },
            )
            raise httpx.HTTPStatusError("Payment Required", request=request, response=response)

        monkeypatch.setattr("app.services.agent.provider_stream.httpx.stream", insufficient_balance)
        balance_stream = client.post(
            f"/api/projects/conversations/{balance_conversation['id']}/stream",
            headers=headers,
            json={"content": "Continue", "modelId": model_id, "tools": DESKTOP_TOOLS},
        )
        balance_body = balance_stream.get_data(as_text=True)
        assert '"errorCode": "provider_http_402:invalid_request_error"' in balance_body
        assert balance_body.endswith("data: [DONE]\n\n")

        agent_conversation = client.post(
            f"/api/projects/{project_id}/conversations",
            headers=headers,
            json={"title": "Agent terminal"},
        ).get_json()

        class ToolProviderResponse(ProviderResponse):
            def iter_lines(self):
                tool_delta = {
                    "choices": [
                        {
                            "delta": {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "id": "call_1",
                                        "function": {
                                            "name": "terminal",
                                            "arguments": json.dumps(
                                                {
                                                    "command": "git status --short",
                                                }
                                            ),
                                        },
                                    }
                                ]
                            }
                        }
                    ]
                }
                return iter(
                    [
                        'data: {"choices":[{"delta":{"content":"I will check first."}}]}',
                        f"data: {json.dumps(tool_delta)}",
                        "data: [DONE]",
                    ]
                )

        class FinalProviderResponse(ProviderResponse):
            def iter_lines(self):
                return iter(
                    [
                        'data: {"choices":[{"delta":{"content":"Working tree is clean."}}]}',
                        "data: [DONE]",
                    ]
                )

        responses = iter([ToolProviderResponse(), FinalProviderResponse()])
        monkeypatch.setattr(
            "app.services.agent.provider_stream.httpx.stream",
            lambda *_args, **_kwargs: next(responses),
        )
        tool_stream = client.post(
            f"/api/projects/conversations/{agent_conversation['id']}/stream",
            headers=headers,
            json={"content": "Check Git", "modelId": model_id, "tools": DESKTOP_TOOLS},
        )
        tool_event = next(
            event
            for line in tool_stream.get_data(as_text=True).splitlines()
            if line.startswith("data: {")
            if (event := json.loads(line.removeprefix("data: ")))["type"] == "tool.requested"
        )
        assert tool_event["type"] == "tool.requested"
        assert tool_event["arguments"]["command"] == "git status --short"
        resumed = client.post(
            f"/api/agent-runs/{tool_event['runId']}/recover",
            headers=headers,
            json={
                "workspaceInstructions": "",
                "results": [
                    {
                        "callId": tool_event["callId"],
                        "result": {"status": "exited", "exitCode": 0, "output": ""},
                    }
                ],
                "tools": DESKTOP_TOOLS,
            },
        )
        assert b"Working tree is clean." in resumed.data
        agent_detail = client.get(
            f"/api/projects/conversations/{agent_conversation['id']}", headers=headers
        ).get_json()
        activity = agent_detail["messages"][-1]["activity"]
        assert [step["type"] for step in activity] == ["message", "tool"]
        assert activity[0]["content"] == "I will check first."
        assert activity[1]["status"] == "completed"
        assert activity[1]["result"]["exitCode"] == 0

        cancelled_conversation = client.post(
            f"/api/projects/{project_id}/conversations",
            headers=headers,
            json={"title": "Cancelled agent"},
        ).get_json()
        captured_requests = []
        cancellation_responses = iter([ToolProviderResponse(), FinalProviderResponse()])

        def cancellation_stream(*_args, **kwargs):
            captured_requests.append(kwargs["json"])
            return next(cancellation_responses)

        monkeypatch.setattr("app.services.agent.provider_stream.httpx.stream", cancellation_stream)
        waiting = client.post(
            f"/api/projects/conversations/{cancelled_conversation['id']}/stream",
            headers=headers,
            json={"content": "Start checking", "modelId": model_id, "tools": DESKTOP_TOOLS},
        )
        started_event = next(
            event
            for line in waiting.get_data(as_text=True).splitlines()
            if line.startswith("data: {")
            if (event := json.loads(line.removeprefix("data: ")))["type"] == "run.started"
        )
        assert (
            client.post(
                f"/api/agent-runs/{started_event['runId']}/cancel",
                headers=headers,
                json={
                    "partialMessage": {
                        "content": "You stopped this task",
                        "activity": [
                            {
                                "id": "partial-step",
                                "type": "message",
                                "content": "I will check first.",
                                "status": "completed",
                            }
                        ],
                    }
                },
            ).status_code
            == 204
        )
        cancelled_detail = client.get(
            f"/api/projects/conversations/{cancelled_conversation['id']}", headers=headers
        ).get_json()
        assert cancelled_detail["messages"][-1]["content"] == "You stopped this task"
        assert cancelled_detail["messages"][-1]["activity"][0]["content"] == ("I will check first.")
        continued = client.post(
            f"/api/projects/conversations/{cancelled_conversation['id']}/stream",
            headers=headers,
            json={"content": "Continue", "modelId": model_id, "tools": DESKTOP_TOOLS},
        )
        assert b"Working tree is clean." in continued.data
        assert any(
            "explicitly stopped" in message.get("content", "")
            for message in captured_requests[-1]["messages"]
        )
        stopped_context = next(
            message["content"]
            for message in captured_requests[-1]["messages"]
            if "explicitly stopped" in message.get("content", "")
        )
        assert "I will check first." in stopped_context
        assert "Tool terminal" in stopped_context
        assert "avoid repeating completed work" in stopped_context
