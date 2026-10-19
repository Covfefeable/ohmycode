from uuid import UUID

import httpx

from ...extensions import db
from ...models import SpeechSettings
from ..errors import ServiceError
from ..model_credentials import decrypt_api_key

DEFAULT_VOICE = "longanhuan_v3.1"
SYSTEM_VOICES = {
    DEFAULT_VOICE,
    "qiaoxiaojiao_v3.1",
    "baiqinglan_v3.1",
    "longanyang_v3.1",
    "andi_v3.1",
}
TTS_MODEL = "qwen-audio-3.1-tts-flash"


def require_speech_settings(user_id: UUID) -> SpeechSettings:
    settings = db.session.get(SpeechSettings, user_id)
    if not settings:
        raise ServiceError("speech_not_configured", 422)
    return settings


def customize_voice(settings: SpeechSettings, parameters: dict) -> dict:
    url = f"https://{settings.workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization"
    try:
        response = httpx.post(
            url,
            headers={"Authorization": f"Bearer {decrypt_api_key(settings.api_key_encrypted)}"},
            json={"model": "voice-enrollment", "input": parameters},
            timeout=60,
        )
    except httpx.HTTPError as error:
        raise ServiceError("speech_connection_failed", 502) from error
    if response.status_code in {401, 403}:
        raise ServiceError("speech_auth_failed", 422)
    if response.status_code == 429:
        raise ServiceError("speech_rate_limited", 429)
    if not response.is_success:
        raise ServiceError("speech_voice_create_failed", 502)
    try:
        payload = response.json()
        if not isinstance(payload.get("output"), dict):
            raise ValueError("Missing provider output")
        return payload["output"]
    except (ValueError, AttributeError) as error:
        raise ServiceError("speech_protocol_error", 502) from error
