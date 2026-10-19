import base64
import wave
from io import BytesIO

import httpx
import pytest
from itsdangerous import TimestampSigner

from app import create_app
from app.extensions import db
from app.models import SpeechVoice


def sample_audio(seconds=15):
    buffer = BytesIO()
    with wave.open(buffer, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b"\x00\x00" * 16000 * seconds)
    return base64.b64encode(buffer.getvalue()).decode()


@pytest.fixture
def voice_client(monkeypatch):
    app = create_app("testing")
    app.config["PUBLIC_API_URL"] = "https://api.example.com:8765"
    samples = {}
    monkeypatch.setattr(
        "app.services.settings.speech_samples.put_object",
        lambda key, content, mime: samples.update({key: (content, mime)}),
    )
    monkeypatch.setattr("app.services.settings.speech_samples.get_object", lambda key: samples[key])
    monkeypatch.setattr(
        "app.services.settings.speech_samples.delete_object", lambda key: samples.pop(key, None)
    )
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
        "audioData": sample_audio(),
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
    sample_url = sent["input"]["url"]
    assert sample_url.startswith("https://api.example.com:8765/api/settings/speech/samples/")
    from urllib.parse import urlsplit

    sample = client.get(urlsplit(sample_url).path)
    assert sample.status_code == 200
    assert sample.mimetype == "audio/wav"
    assert sample.data == base64.b64decode(payload["audioData"])
    assert sample.headers["Cache-Control"] == "no-store"
    assert client.get(urlsplit(sample_url).path + "broken").status_code == 404
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
            "audioData": sample_audio(),
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
        {"audioData": "invalid base64"},
        {"audioData": sample_audio(2)},
        {"audioData": sample_audio(31)},
        {"consent": False},
        {"language": "unknown"},
        {"name": ""},
    ]:
        payload = {
            "name": "Voice",
            "audioData": sample_audio(),
            "language": "zh",
            "consent": True,
            **patch,
        }
        assert (
            client.post("/api/settings/speech/voices", headers=headers, json=payload).status_code
            == 422
        )


def test_expired_sample_link_cannot_read_audio(voice_client, monkeypatch):
    from app.services.settings.speech_samples import store_sample

    app, client, _, _ = voice_client
    with monkeypatch.context() as patch:
        patch.setattr(TimestampSigner, "get_timestamp", lambda _: 1)
        with app.app_context():
            _, url = store_sample(sample_audio())
    from urllib.parse import urlsplit

    assert client.get(urlsplit(url).path).status_code == 404


def test_missing_public_address_does_not_upload_audio(voice_client, monkeypatch):
    app, client, headers, _ = voice_client
    app.config["PUBLIC_API_URL"] = ""
    uploaded = []
    monkeypatch.setattr(
        "app.services.settings.speech_samples.put_object", lambda *args: uploaded.append(args)
    )
    response = client.post(
        "/api/settings/speech/voices",
        headers=headers,
        json={
            "name": "Voice",
            "audioData": sample_audio(),
            "language": "zh",
            "consent": True,
        },
    )
    assert response.status_code == 503
    assert response.get_json()["error"]["code"] == "speech_public_url_missing"
    assert uploaded == []


def test_cleanup_only_removes_expired_sample_objects(monkeypatch):
    from datetime import UTC, datetime, timedelta
    from types import SimpleNamespace

    from app.services import object_storage

    now = datetime.now(UTC)
    removed = []
    prefixes = []

    class Storage:
        def list_objects(self, bucket, *, prefix, recursive):
            prefixes.append(prefix)
            return [
                SimpleNamespace(
                    object_name="speech-samples/old.wav", last_modified=now - timedelta(days=2)
                ),
                SimpleNamespace(object_name="speech-samples/new.wav", last_modified=now),
            ]

        def remove_object(self, bucket, key):
            removed.append(key)

    monkeypatch.setattr(object_storage, "_client", Storage)
    monkeypatch.setattr(object_storage, "_bucket", lambda _: "test")
    from app.services.settings.speech_samples import cleanup_samples

    assert cleanup_samples() == 1
    assert prefixes == ["speech-samples/"]
    assert removed == ["speech-samples/old.wav"]
