import re
from uuid import UUID

from ...extensions import db
from ...models import SpeechSettings
from ..errors import ServiceError
from ..model_credentials import decrypt_api_key, encrypt_api_key
from .speech_provider import DEFAULT_VOICE, require_speech_settings
from .speech_voices import validate_voice

VOICE_CHAT_INSTRUCTIONS = (
    "Voice chat mode is enabled. Write user-visible progress updates and answers for listening: "
    "use conversational, concise language and short natural sentences. Prefer plain paragraphs; "
    "avoid tables, decorative symbols, dense Markdown, and unnecessary lists. "
    "Lead with the result. "
    "Keep required code, commands and file contents correct; this style preference does not change "
    "tool protocols or the requested artifacts. Do not output SSML or voice-control markup."
)


def voice_chat_context(user_id: UUID) -> list[dict]:
    settings = db.session.get(SpeechSettings, user_id)
    if not settings or not settings.auto_play:
        return []
    return [{"role": "system", "content": VOICE_CHAT_INSTRUCTIONS}]


def get_speech_settings(user_id: UUID) -> dict:
    settings = db.session.get(SpeechSettings, user_id)
    return {
        "workspaceId": settings.workspace_id if settings else "",
        "voice": settings.voice if settings else DEFAULT_VOICE,
        "autoPlay": settings.auto_play if settings else False,
        "hasApiKey": bool(settings and settings.api_key_encrypted),
    }


def save_speech_settings(user_id: UUID, payload: dict) -> dict:
    workspace_id = str(payload.get("workspaceId") or "").strip()
    voice = str(payload.get("voice") or "").strip()
    if not re.fullmatch(r"[a-zA-Z0-9-]{1,100}", workspace_id) or not re.fullmatch(
        r"[a-zA-Z0-9_.-]{1,255}", voice
    ):
        raise ServiceError("validation_error", 422)
    validate_voice(user_id, workspace_id, voice)
    settings = db.session.get(SpeechSettings, user_id)
    api_key = str(payload.get("apiKey") or "").strip()
    if not api_key and not settings:
        raise ServiceError("speech_not_configured", 422)
    if settings is None:
        settings = SpeechSettings(user_id=user_id)
        db.session.add(settings)
    settings.workspace_id = workspace_id
    settings.voice = voice
    if api_key:
        settings.api_key_encrypted = encrypt_api_key(api_key)
    db.session.commit()
    return get_speech_settings(user_id)


def set_speech_auto_play(user_id: UUID, enabled: bool) -> dict:
    settings = db.session.get(SpeechSettings, user_id)
    if not settings:
        raise ServiceError("speech_not_configured", 422)
    settings.auto_play = enabled
    db.session.commit()
    return get_speech_settings(user_id)


def speech_connection(user_id: UUID) -> dict:
    settings = require_speech_settings(user_id)
    validate_voice(user_id, settings.workspace_id, settings.voice)
    return {
        "url": f"wss://{settings.workspace_id}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
        "apiKey": decrypt_api_key(settings.api_key_encrypted),
        "voice": settings.voice,
    }
