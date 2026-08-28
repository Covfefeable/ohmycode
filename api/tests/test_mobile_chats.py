import json
import uuid

from app import create_app
from app.extensions import db
from app.models import AgentRun


def _tools(*names: str) -> list[dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": name,
                "description": f"{name} tool",
                "parameters": {"type": "object", "properties": {}},
            },
        }
        for name in names
    ]


MOBILE_TOOLS = _tools(
    "update_tasks",
    "search_capabilities",
    "load_capability",
    "read_tool_result",
    "search_tool_result",
)


def _headers(client, email: str) -> dict[str, str]:
    registration = client.post(
        "/api/auth/register",
        json={"email": email, "displayName": "Mobile User", "password": "secret123"},
    )
    return {
        "Authorization": f"Bearer {registration.get_json()['tokens']['accessToken']}"
    }


def test_mobile_conversations_are_account_scoped_and_hidden_from_projects():
    app = create_app("testing")
    with app.app_context():
        db.create_all()

    with app.test_client() as client:
        owner = _headers(client, "mobile-owner@example.com")
        other = _headers(client, "mobile-other@example.com")
        created = client.post(
            "/api/mobile/conversations", headers=owner, json={"title": "Phone chat"}
        )
        conversation_id = created.get_json()["id"]

        assert created.status_code == 201
        assert client.get("/api/mobile/conversations", headers=owner).get_json()[0][
            "id"
        ] == conversation_id
        assert (
            client.get(f"/api/mobile/conversations/{conversation_id}", headers=other).status_code
            == 404
        )
        assert (
            client.delete(
                f"/api/mobile/conversations/{conversation_id}", headers=other
            ).status_code
            == 404
        )
        desktop_headers = {
            **owner,
            "X-OhMyCode-Device-Id": "desktop-a",
            "X-OhMyCode-Device-Name": "Desktop",
        }
        assert client.get("/api/projects", headers=desktop_headers).get_json() == []
        assert (
            client.delete(
                f"/api/mobile/conversations/{conversation_id}", headers=owner
            ).status_code
            == 204
        )
        assert client.get("/api/mobile/conversations", headers=owner).get_json() == []


def test_mobile_stream_does_not_offer_desktop_tools(monkeypatch):
    app = create_app("testing")
    with app.app_context():
        db.create_all()

    provider_payloads = []

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
                    'data: {"choices":[{"delta":{"content":"Hello from mobile"}}]}',
                    "data: [DONE]",
                ]
            )

    def provider_stream(*_args, **kwargs):
        provider_payloads.append(kwargs["json"])
        return ProviderResponse()

    monkeypatch.setattr("app.services.agent.provider_stream.httpx.stream", provider_stream)

    with app.test_client() as client:
        headers = _headers(client, "mobile-stream@example.com")
        model_id = str(uuid.uuid4())
        assert (
            client.put(
                "/api/settings/models",
                headers=headers,
                json={
                    "models": [
                        {
                            "id": model_id,
                            "name": "Mobile model",
                            "baseUrl": "https://example.com/v1",
                            "model": "example-model",
                            "apiKey": "server-only-secret",
                        }
                    ]
                },
            ).status_code
            == 204
        )
        conversation_id = client.post(
            "/api/mobile/conversations", headers=headers, json={}
        ).get_json()["id"]
        response = client.post(
            f"/api/mobile/conversations/{conversation_id}/stream",
            headers=headers,
            json={
                "content": "Hello", "modelId": model_id,
                "turnId": str(uuid.uuid4()), "tools": MOBILE_TOOLS,
            },
        )

    assert response.status_code == 200
    assert b"Hello from mobile" in response.data
    assert [tool["function"]["name"] for tool in provider_payloads[0]["tools"]] == [
        "update_tasks",
        "search_capabilities",
        "load_capability",
        "read_tool_result",
        "search_tool_result",
    ]
    assert "mobile assistant" in provider_payloads[0]["messages"][0]["content"]


def test_mobile_load_capability_adds_only_loaded_tools_on_resume(monkeypatch):
    app = create_app("testing")
    with app.app_context():
        db.create_all()

    provider_payloads = []
    responses = iter(
        [
            [
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,'
                '"id":"load-1","function":{"name":"load_capability",'
                '"arguments":"{\\"id\\":\\"mcp:example\\"}"}}]}}]}',
                "data: [DONE]",
            ],
            [
                'data: {"choices":[{"delta":{"content":"Loaded"}}]}',
                "data: [DONE]",
            ],
            [
                'data: {"choices":[{"delta":{"content":"Using loaded tool"}}]}',
                "data: [DONE]",
            ],
        ]
    )

    class ProviderResponse:
        def __init__(self, lines):
            self.lines = lines

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def raise_for_status(self):
            return None

        def iter_lines(self):
            return iter(self.lines)

    def provider_stream(*_args, **kwargs):
        provider_payloads.append(kwargs["json"])
        return ProviderResponse(next(responses))

    monkeypatch.setattr("app.services.agent.provider_stream.httpx.stream", provider_stream)

    with app.test_client() as client:
        headers = _headers(client, "mobile-capability@example.com")
        other_headers = _headers(client, "mobile-capability-other@example.com")
        model_id = str(uuid.uuid4())
        client.put(
            "/api/settings/models",
            headers=headers,
            json={
                "models": [
                    {
                        "id": model_id,
                        "name": "Mobile model",
                        "baseUrl": "https://example.com/v1",
                        "model": "example-model",
                        "apiKey": "server-only-secret",
                    }
                ]
            },
        )
        conversation_id = client.post(
            "/api/mobile/conversations", headers=headers, json={}
        ).get_json()["id"]
        run_id = str(uuid.uuid4())
        first = client.post(
            f"/api/mobile/conversations/{conversation_id}/stream",
            headers=headers,
            json={
                "content": "Load it", "modelId": model_id,
                "turnId": run_id, "tools": MOBILE_TOOLS,
            },
        )
        first_data = first.data
        loaded_tool = {
            "type": "function",
            "function": {
                "name": "mcp__example__lookup",
                "description": "Lookup",
                "parameters": {"type": "object", "properties": {}},
            },
        }
        long_document = "begin\n" + ("middle passage\n" * 800) + "end"
        resumed = client.post(
            f"/api/mobile/conversations/runs/{run_id}/resume",
            headers=headers,
            json={
                "results": [
                    {
                        "callId": "load-1",
                        "result": {
                            "id": "mcp:example",
                            "tools": [loaded_tool],
                            "document": long_document,
                        },
                    }
                ],
                "tools": [*MOBILE_TOOLS, loaded_tool],
            },
        )
        resumed_data = resumed.data
        read_result = client.post(
            f"/api/mobile/conversations/runs/{run_id}/tool-results/load-1/read",
            headers=headers,
            json={"maxTokens": 128},
        )
        searched_result = client.post(
            f"/api/mobile/conversations/runs/{run_id}/tool-results/load-1/search",
            headers=headers,
            json={"query": "mcp__example"},
        )
        pages = []
        cursor = 0
        while True:
            page_response = client.post(
                f"/api/mobile/conversations/runs/{run_id}/tool-results/load-1/read",
                headers=headers,
                json={"cursor": cursor, "maxTokens": 128},
            )
            page = page_response.get_json()
            pages.append(page["content"])
            if page["complete"]:
                break
            cursor = page["nextCursor"]
        forbidden_result = client.post(
            f"/api/mobile/conversations/runs/{run_id}/tool-results/load-1/read",
            headers=other_headers,
            json={},
        )
        next_run_id = str(uuid.uuid4())
        next_turn = client.post(
            f"/api/mobile/conversations/{conversation_id}/stream",
            headers=headers,
            json={
                "content": "Use it", "modelId": model_id, "turnId": next_run_id,
                "tools": [*MOBILE_TOOLS, loaded_tool],
            },
        )

    assert first.status_code == 200
    assert b'"tool": "load_capability"' in first_data
    assert resumed.status_code == 200
    assert b"Loaded" in resumed_data
    assert [tool["function"]["name"] for tool in provider_payloads[1]["tools"]] == [
        "update_tasks",
        "search_capabilities",
        "load_capability",
        "read_tool_result",
        "search_tool_result",
        "mcp__example__lookup",
    ]
    assert read_result.status_code == 200
    assert read_result.get_json()["callId"] == "load-1"
    assert searched_result.status_code == 200
    assert searched_result.get_json()["matches"]
    reconstructed_result = json.loads("".join(pages))
    assert reconstructed_result["document"] == long_document
    assert forbidden_result.status_code == 404
    assert next_turn.status_code == 200
    assert b"Using loaded tool" in next_turn.data
    assert [tool["function"]["name"] for tool in provider_payloads[2]["tools"]] == [
        "update_tasks",
        "search_capabilities",
        "load_capability",
        "read_tool_result",
        "search_tool_result",
        "mcp__example__lookup",
    ]
    with app.app_context():
        run = db.session.get(AgentRun, uuid.UUID(run_id))
        assert [tool["function"]["name"] for tool in run.tool_snapshot] == [
            "update_tasks",
            "search_capabilities",
            "load_capability",
            "read_tool_result",
            "search_tool_result",
            "mcp__example__lookup",
        ]


def test_mobile_cancel_persists_partial_message(monkeypatch):
    app = create_app("testing")
    with app.app_context():
        db.create_all()

    class ProviderResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def raise_for_status(self):
            return None

        def iter_lines(self):
            return iter([
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,'
                '"id":"search-1","function":{"name":"search_capabilities",'
                '"arguments":"{\\"query\\":\\"web\\"}"}}]}}]}',
                "data: [DONE]",
            ])

    monkeypatch.setattr(
        "app.services.agent.provider_stream.httpx.stream",
        lambda *_args, **_kwargs: ProviderResponse(),
    )

    with app.test_client() as client:
        headers = _headers(client, "mobile-cancel@example.com")
        model_id = str(uuid.uuid4())
        client.put(
            "/api/settings/models",
            headers=headers,
            json={
                "models": [{
                    "id": model_id,
                    "name": "Mobile model",
                    "baseUrl": "https://example.com/v1",
                    "model": "example-model",
                    "apiKey": "server-only-secret",
                }]
            },
        )
        conversation_id = client.post(
            "/api/mobile/conversations", headers=headers, json={}
        ).get_json()["id"]
        run_id = str(uuid.uuid4())
        streamed = client.post(
            f"/api/mobile/conversations/{conversation_id}/stream",
            headers=headers,
            json={
                "content": "Search", "modelId": model_id,
                "turnId": run_id, "tools": MOBILE_TOOLS,
            },
        )
        streamed_data = streamed.data
        activity = [{
            "id": "search-1",
            "type": "tool",
            "tool": "search_capabilities",
            "input": {"query": "web"},
            "status": "running",
        }]
        cancelled = client.post(
            f"/api/mobile/conversations/runs/{run_id}/cancel",
            headers=headers,
            json={"partialMessage": {"content": "正在搜索", "activity": activity}},
        )
        conversation = client.get(
            f"/api/mobile/conversations/{conversation_id}", headers=headers
        ).get_json()

    assert b'"tool": "search_capabilities"' in streamed_data
    assert cancelled.status_code == 204
    assistant = conversation["messages"][-1]
    assert assistant["content"] == "正在搜索"
    assert assistant["activity"] == activity
