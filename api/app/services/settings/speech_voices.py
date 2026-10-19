from urllib.parse import urlsplit
from uuid import UUID, uuid4

from ...extensions import db
from ...models import SpeechVoice
from ..errors import ServiceError
from .speech_provider import SYSTEM_VOICES, TTS_MODEL, customize_voice, require_speech_settings


def voice_records(user_id: UUID, workspace_id: str) -> list[SpeechVoice]:
    return list(
        db.session.scalars(
            db.select(SpeechVoice)
            .where(
                SpeechVoice.user_id == user_id,
                SpeechVoice.workspace_id == workspace_id,
                SpeechVoice.target_model == TTS_MODEL,
            )
            .order_by(SpeechVoice.created_at, SpeechVoice.id)
        )
    )


def serialize_voice(voice: SpeechVoice) -> dict:
    return {
        "id": str(voice.id),
        "voiceId": voice.voice_id,
        "name": voice.name,
        "status": voice.status,
    }


def list_voices(user_id: UUID) -> list[dict]:
    settings = require_speech_settings(user_id)
    return [serialize_voice(voice) for voice in voice_records(user_id, settings.workspace_id)]


def validate_voice(user_id: UUID, workspace_id: str, voice_id: str) -> None:
    if voice_id in SYSTEM_VOICES:
        return
    voice = db.session.scalar(
        db.select(SpeechVoice).where(
            SpeechVoice.user_id == user_id,
            SpeechVoice.workspace_id == workspace_id,
            SpeechVoice.target_model == TTS_MODEL,
            SpeechVoice.voice_id == voice_id,
        )
    )
    if not voice or voice.status != "OK":
        raise ServiceError("speech_voice_not_ready", 422)


def create_voice(user_id: UUID, payload: dict) -> dict:
    settings = require_speech_settings(user_id)
    name = str(payload.get("name") or "").strip()
    audio_url = str(payload.get("audioUrl") or "").strip()
    language = str(payload.get("language") or "").strip()
    preprocess = payload.get("preprocess", False)
    try:
        parsed_url = urlsplit(audio_url)
    except ValueError as error:
        raise ServiceError("speech_voice_invalid", 422) from error
    if (
        not 1 <= len(name) <= 100
        or parsed_url.scheme not in {"http", "https"}
        or not parsed_url.hostname
        or language
        not in {
            "zh",
            "en",
            "fr",
            "de",
            "ja",
            "ko",
            "ru",
            "pt",
            "th",
            "id",
            "vi",
            "it",
            "es",
            "ms",
            "fil",
            "ar",
        }
        or not isinstance(preprocess, bool)
        or payload.get("consent") is not True
    ):
        raise ServiceError("speech_voice_invalid", 422)
    output = customize_voice(
        settings,
        {
            "action": "create_voice",
            "target_model": TTS_MODEL,
            "prefix": uuid4().hex[:10],
            "url": audio_url,
            "language_hints": [language],
            "enable_preprocess": preprocess,
        },
    )
    voice_id = output.get("voice_id")
    if not isinstance(voice_id, str) or not 1 <= len(voice_id) <= 255:
        raise ServiceError("speech_protocol_error", 502)
    voice = SpeechVoice(
        user_id=user_id,
        workspace_id=settings.workspace_id,
        voice_id=voice_id,
        name=name,
        target_model=TTS_MODEL,
        status="DEPLOYING",
    )
    db.session.add(voice)
    db.session.commit()
    return serialize_voice(voice)


def refresh_voices(user_id: UUID) -> list[dict]:
    settings = require_speech_settings(user_id)
    voices = voice_records(user_id, settings.workspace_id)
    for voice in voices:
        if voice.status != "DEPLOYING":
            continue
        output = customize_voice(settings, {"action": "query_voice", "voice_id": voice.voice_id})
        status = output.get("status")
        if status not in {"DEPLOYING", "OK", "UNDEPLOYED"}:
            raise ServiceError("speech_protocol_error", 502)
        voice.status = status
    db.session.commit()
    return [serialize_voice(voice) for voice in voices]
