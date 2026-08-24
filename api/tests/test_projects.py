import uuid

from app import create_app
from app.extensions import db


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
        headers = {"Authorization": f"Bearer {token}"}

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
                        'data: {"choices":[{"delta":{"content":"Hello "}}]}',
                        'data: {"choices":[{"delta":{"content":"stream"}}]}',
                        "data: [DONE]",
                    ]
                )

        monkeypatch.setattr(
            "app.routes.projects.httpx.stream", lambda *_args, **_kwargs: ProviderResponse()
        )
        streamed = client.post(
            f"/api/projects/conversations/{conversation_id}/stream",
            headers=headers,
            json={"content": "Continue", "modelId": model_id},
        )
        assert streamed.status_code == 200
        assert b'"content": "Hello "' in streamed.data
        assert b'"content": "stream"' in streamed.data
        final_detail = client.get(
            f"/api/projects/conversations/{conversation_id}", headers=headers
        ).get_json()
        assert final_detail["messages"][-1]["content"] == "Hello stream"
