from app import create_app
from app.extensions import db
from app.models import SpeechSettings
from app.services.model_credentials import decrypt_api_key


def test_speech_credentials_are_scoped_encrypted_and_not_in_public_settings():
    app = create_app("testing")
    with app.app_context():
        db.create_all()
    with app.test_client() as client:
        assert client.get("/api/settings/speech").status_code == 401

        def register(email):
            auth = client.post(
                "/api/auth/register",
                json={"email": email, "displayName": "Voice", "password": "secret123"},
            ).get_json()
            return {"Authorization": f"Bearer {auth['tokens']['accessToken']}"}

        headers = register("voice@example.com")
        other = register("other-voice@example.com")
        initial = client.get("/api/settings/speech", headers=headers).get_json()
        assert initial["hasApiKey"] is False
        assert initial["autoPlay"] is False
        assert client.post("/api/settings/speech/connection", headers=headers).status_code == 422
        payload = {
            "workspaceId": "llm-example",
            "voice": "longanhuan_v3.1",
            "apiKey": "test-voice-key",
        }
        saved = client.put("/api/settings/speech", headers=headers, json=payload)
        assert saved.status_code == 200
        assert saved.get_json()["hasApiKey"] is True
        assert "apiKey" not in saved.get_json()
        with app.app_context():
            stored = db.session.scalar(db.select(SpeechSettings))
            assert stored.api_key_encrypted != b"test-voice-key"
            assert decrypt_api_key(stored.api_key_encrypted) == "test-voice-key"
        connection = client.post("/api/settings/speech/connection", headers=headers)
        assert connection.headers["Cache-Control"] == "no-store"
        assert connection.get_json()["apiKey"] == "test-voice-key"
        assert (
            connection.get_json()["url"]
            == "wss://llm-example.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference"
        )
        assert client.get("/api/settings/speech", headers=other).get_json()["hasApiKey"] is False
        assert client.post("/api/settings/speech/connection", headers=other).status_code == 422
        assert (
            client.put(
                "/api/settings/speech/auto-play", headers=headers, json={"enabled": True}
            ).get_json()["autoPlay"]
            is True
        )
        payload["apiKey"] = ""
        assert (
            client.put("/api/settings/speech", headers=headers, json=payload).get_json()["autoPlay"]
            is True
        )
        assert (
            client.post("/api/settings/speech/connection", headers=headers).get_json()["apiKey"]
            == "test-voice-key"
        )
        payload["workspaceId"] = "example.com/override"
        assert client.put("/api/settings/speech", headers=headers, json=payload).status_code == 422
        assert (
            client.put(
                "/api/settings/speech/auto-play", headers=headers, json={"enabled": "false"}
            ).status_code
            == 422
        )
