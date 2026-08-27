import uuid

from app import create_app
from app.extensions import db


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
        desktop_headers = {
            **owner,
            "X-OhMyCode-Device-Id": "desktop-a",
            "X-OhMyCode-Device-Name": "Desktop",
        }
        assert client.get("/api/projects", headers=desktop_headers).get_json() == []


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
            json={"content": "Hello", "modelId": model_id, "turnId": str(uuid.uuid4())},
        )

    assert response.status_code == 200
    assert b"Hello from mobile" in response.data
    assert [tool["function"]["name"] for tool in provider_payloads[0]["tools"]] == [
        "update_tasks"
    ]
    assert "mobile assistant" in provider_payloads[0]["messages"][0]["content"]
