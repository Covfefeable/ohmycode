import base64
import binascii
import wave
from datetime import UTC, datetime, timedelta
from io import BytesIO
from uuid import uuid4

from flask import current_app
from itsdangerous import BadSignature, URLSafeTimedSerializer

from ..errors import ServiceError
from ..object_storage import delete_object, get_object, put_object, remove_old_objects

SAMPLE_PREFIX = "speech-samples/"
SAMPLE_TTL = 24 * 60 * 60
MAX_AUDIO_BYTES = 2_000_000


def _signer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="speech-sample")


def store_sample(encoded: object) -> tuple[str, str]:
    base_url = current_app.config["PUBLIC_API_URL"].rstrip("/")
    if not base_url.startswith(("https://", "http://")):
        raise ServiceError("speech_public_url_missing", 503)
    if not isinstance(encoded, str) or len(encoded) > (MAX_AUDIO_BYTES + 2) // 3 * 4:
        raise ServiceError("speech_voice_invalid", 422)
    try:
        content = base64.b64decode(encoded, validate=True)
        with wave.open(BytesIO(content)) as audio:
            duration = audio.getnframes() / audio.getframerate()
            if (
                audio.getnchannels() != 1
                or audio.getsampwidth() != 2
                or audio.getframerate() < 16000
                or not 10 <= duration <= 30
                or len(audio.readframes(audio.getnframes())) != audio.getnframes() * 2
            ):
                raise ValueError("invalid_audio")
    except (binascii.Error, wave.Error, EOFError, ValueError, ZeroDivisionError) as error:
        raise ServiceError("speech_voice_invalid", 422) from error
    key = f"{SAMPLE_PREFIX}{uuid4().hex}.wav"
    put_object(key, content, "audio/wav")
    token = _signer().dumps(key)
    return key, f"{base_url}/api/settings/speech/samples/{token}"


def read_sample(token: str) -> tuple[bytes, str]:
    try:
        key = _signer().loads(token, max_age=SAMPLE_TTL)
    except BadSignature as error:
        raise ServiceError("speech_sample_expired", 404) from error
    return get_object(key)


def discard_sample(key: str) -> None:
    delete_object(key)


def cleanup_samples() -> int:
    return remove_old_objects(SAMPLE_PREFIX, datetime.now(UTC) - timedelta(seconds=SAMPLE_TTL))
