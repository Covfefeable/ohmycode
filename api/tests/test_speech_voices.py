import httpx
import pytest

from app import create_app
from app.extensions import db
from app.models import SpeechVoice


@pytest.fixture
def voice_client():
    app = create_app("testing")
    with app.app_context():
        db.create_all()
    with app.test_client() as client:

        def account(email):
            auth = client.post(
                "/api/auth/register",
                json={
                    "email": email,
                    "displayName": "Voice",
                    "password": "secret123",
                },
            ).get_json()
            headers = {"Authorization": f"Bearer {auth['tokens']['accessToken']}"}
            client.put(
                "/api/settings/speech",
                headers=headers,
                json={
                    "workspaceId": "llm-test",
                    "voice": "longanhuan_v3.1",
                    "apiKey": "voice-test-key",
                },
            )
            return headers

        yield app, client, account("clones@example.com"), account("other-clones@example.com")


@pytest.mark.parametrize(
    "voice",
    [
        "qiaoxiaojiao_v3.1",
        "baiqinglan_v3.1",
        "longanyang_v3.1",
        "andi_v3.1",
    ],
)
def test_system_voice_can_be_saved_and_used(voice_client, voice):
    _, client, headers, _ = voice_client
    response = client.put(
        "/api/settings/speech",
        headers=headers,
        json={"workspaceId": "llm-test", "voice": voice},
    )
    assert response.status_code == 200
    connection = client.post("/api/settings/speech/connection", headers=headers)
    assert connection.status_code == 200
    assert connection.get_json()["voice"] == voice


def test_create_refresh_select_and_scope_custom_voice(voice_client, monkeypatch):
    app, client, headers, other = voice_client
    requests = []

    def post(url, **kwargs):
        requests.append((url, kwargs))
        action = kwargs["json"]["input"]["action"]
        output = (
            {"voice_id": "qwen-audio-3.1-tts-flash-custom-123"}
            if action == "create_voice"
            else {"status": "OK"}
        )
        return httpx.Response(200, json={"output": output})

    monkeypatch.setattr("app.services.settings.speech_provider.httpx.post", post)
    payload = {
        "name": "我的声音",
        "audioUrl": "https://example.com/sample.wav",
        "language": "zh",
        "preprocess": True,
        "consent": True,
    }
    response = client.post("/api/settings/speech/voices", headers=headers, json=payload)
    assert response.status_code == 201
    voice = response.get_json()
    assert voice["status"] == "DEPLOYING"
    assert voice["name"] == "我的声音"
    assert (
        requests[0][0]
        == "https://llm-test.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization"
    )
    sent = requests[0][1]["json"]
    assert sent["model"] == "voice-enrollment"
    assert sent["input"]["target_model"] == "qwen-audio-3.1-tts-flash"
    assert sent["input"]["url"] == payload["audioUrl"]
    assert sent["input"]["enable_preprocess"] is True
    assert sent["input"]["prefix"].isalnum() and len(sent["input"]["prefix"]) <= 10
    assert client.get("/api/settings/speech/voices", headers=other).get_json() == []
    selection = {"workspaceId": "llm-test", "voice": voice["voiceId"]}
    assert client.put("/api/settings/speech", headers=headers, json=selection).status_code == 422
    refreshed = client.post("/api/settings/speech/voices/refresh", headers=headers).get_json()
    assert refreshed[0]["status"] == "OK"
    assert client.put("/api/settings/speech", headers=headers, json=selection).status_code == 200
    assert client.put("/api/settings/speech", headers=other, json=selection).status_code == 422
    assert (
        client.post("/api/settings/speech/connection", headers=headers).get_json()["voice"]
        == voice["voiceId"]
    )
    selection = {"workspaceId": "llm-other", "voice": "longanhuan_v3.1"}
    assert client.put("/api/settings/speech", headers=headers, json=selection).status_code == 200
    assert client.get("/api/settings/speech/voices", headers=headers).get_json() == []
    with app.app_context():
        assert db.session.scalar(db.select(SpeechVoice)).name == "我的声音"


@pytest.mark.parametrize(
    "status,code",
    [
        (401, "speech_auth_failed"),
        (429, "speech_rate_limited"),
        (400, "speech_voice_create_failed"),
    ],
)
def test_provider_errors_do_not_create_voice_or_leak_provider_message(
    voice_client, monkeypatch, status, code
):
    app, client, headers, _ = voice_client
    monkeypatch.setattr(
        "app.services.settings.speech_provider.httpx.post",
        lambda *args, **kwargs: httpx.Response(
            status, json={"message": "sensitive provider detail"}
        ),
    )
    response = client.post(
        "/api/settings/speech/voices",
        headers=headers,
        json={
            "name": "Voice",
            "audioUrl": "https://example.com/audio.wav",
            "language": "en",
            "consent": True,
        },
    )
    assert response.get_json() == {"error": {"code": code}}
    with app.app_context():
        assert db.session.scalar(db.select(db.func.count()).select_from(SpeechVoice)) == 0


def test_invalid_input_does_not_call_provider(voice_client, monkeypatch):
    _, client, headers, _ = voice_client

    def unexpected(*args, **kwargs):
        raise AssertionError("Provider must not be called")

    monkeypatch.setattr("app.services.settings.speech_provider.httpx.post", unexpected)
    for patch in [
        {"audioUrl": "file:///sample.wav"},
        {"consent": False},
        {"language": "unknown"},
        {"name": ""},
    ]:
        payload = {
            "name": "Voice",
            "audioUrl": "https://example.com/audio.wav",
            "language": "zh",
            "consent": True,
            **patch,
        }
        assert (
            client.post("/api/settings/speech/voices", headers=headers, json=payload).status_code
            == 422
        )
