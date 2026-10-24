from uuid import uuid4

from app import create_app
from app.extensions import db


def test_models_listing_is_authenticated_and_only_returns_models():
    app = create_app("testing")
    with app.app_context():
        db.create_all()
    with app.test_client() as client:
        assert client.get("/api/settings/models").status_code == 401
        auth = client.post(
            "/api/auth/register",
            json={
                "email": "models-only@example.com",
                "displayName": "Models",
                "password": "secret123",
            },
        ).get_json()
        headers = {"Authorization": f"Bearer {auth['tokens']['accessToken']}"}
        response = client.get("/api/settings/models", headers=headers)
        assert response.status_code == 200
        assert response.get_json() == []
        assert not any(
            rule.rule.endswith("/tasks/<uuid:task_id>/team") for rule in app.url_map.iter_rules()
        )


def test_model_vision_flag_requires_a_json_boolean():
    app = create_app("testing")
    with app.app_context():
        db.create_all()
    with app.test_client() as client:
        auth = client.post(
            "/api/auth/register",
            json={
                "email": "vision-flag@example.com",
                "displayName": "Vision",
                "password": "secret123",
            },
        ).get_json()
        headers = {"Authorization": f"Bearer {auth['tokens']['accessToken']}"}
        model = {
            "id": str(uuid4()),
            "name": "Model",
            "baseUrl": "https://example.com/v1",
            "model": "model",
            "apiKey": "test-key",
        }
        for value in [True, False, "true", "yes", 1, None]:
            response = client.put(
                "/api/settings/models",
                headers=headers,
                json={"models": [{**model, "supportsVision": value}]},
            )
            assert response.status_code == (204 if isinstance(value, bool) else 422)
        saved = client.get("/api/settings/models", headers=headers).get_json()
        assert saved[0]["supportsVision"] is False
