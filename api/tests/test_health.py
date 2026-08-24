from app import create_app
from app.extensions import db


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
