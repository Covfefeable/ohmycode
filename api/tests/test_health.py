import pytest

from app import create_app
from app.config import ProductionConfig
from app.extensions import db
from app.services.settings import commands as settings_commands


def create_test_app():
    app = create_app("testing")
    with app.app_context():
        db.create_all()
    return app


def test_liveness_does_not_require_dependencies():
    app = create_test_app()

    with app.test_client() as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.get_json()["status"] == "ok"


def test_register_login_and_current_user():
    app = create_test_app()
    with app.test_client() as client:
        registration = client.post(
            "/api/auth/register",
            json={
                "email": "agent@example.com",
                "displayName": "Agent User",
                "password": "secret123",
            },
        )
        assert registration.status_code == 201
        access_token = registration.get_json()["tokens"]["accessToken"]

        current_user = client.get(
            "/api/auth/me", headers={"Authorization": f"Bearer {access_token}"}
        )
        assert current_user.status_code == 200
        assert current_user.get_json()["user"]["email"] == "agent@example.com"

        login = client.post(
            "/api/auth/login", json={"email": "agent@example.com", "password": "secret123"}
        )
        assert login.status_code == 200


def test_registration_rejects_duplicate_email():
    app = create_test_app()
    payload = {"email": "agent@example.com", "displayName": "Agent User", "password": "secret123"}
    with app.test_client() as client:
        assert client.post("/api/auth/register", json=payload).status_code == 201
        duplicate = client.post("/api/auth/register", json=payload)
    assert duplicate.status_code == 409


def test_avatar_is_stored_outside_the_database(monkeypatch):
    app = create_test_app()
    stored: dict[str, object] = {}

    def put_object(key: str, content: bytes, content_type: str) -> None:
        stored.update(key=key, content=content, content_type=content_type)

    monkeypatch.setattr(settings_commands, "put_object", put_object)
    monkeypatch.setattr(
        settings_commands,
        "get_object",
        lambda key: (stored["content"], stored["content_type"]),
    )
    with app.test_client() as client:
        registration = client.post(
            "/api/auth/register",
            json={
                "email": "avatar@example.com",
                "displayName": "Avatar User",
                "password": "secret123",
            },
        )
        headers = {
            "Authorization": f"Bearer {registration.get_json()['tokens']['accessToken']}"
        }
        response = client.put(
            "/api/settings/avatar",
            headers=headers,
            json={"data": "iVBORw0KGgo=", "contentType": "image/png"},
        )
        avatar = client.get("/api/settings/avatar", headers=headers)
        settings = client.get("/api/settings", headers=headers).get_json()

    assert response.status_code == 204
    assert stored["key"].startswith("avatars/")
    assert avatar.data == b"\x89PNG\r\n\x1a\n"
    assert avatar.content_type == "image/png"
    assert settings["profile"]["avatarAvailable"] is True


def test_production_rejects_placeholder_secrets(monkeypatch):
    monkeypatch.setattr(ProductionConfig, "SECRET_KEY", "replace-with-a-long-random-secret")
    monkeypatch.setattr(ProductionConfig, "JWT_SECRET_KEY", "x" * 32)

    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        ProductionConfig.validate()


def test_production_requires_independent_secrets(monkeypatch):
    shared_secret = "x" * 32
    monkeypatch.setattr(ProductionConfig, "SECRET_KEY", shared_secret)
    monkeypatch.setattr(ProductionConfig, "JWT_SECRET_KEY", shared_secret)

    with pytest.raises(RuntimeError, match="must be different"):
        ProductionConfig.validate()
