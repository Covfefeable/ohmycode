from uuid import UUID

from flask import Blueprint, Response, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..services.settings import (
    get_avatar,
    get_settings,
    save_avatar,
    save_background_tasks,
    save_models,
    save_profile,
    test_model,
)
from ..services.settings.commands import list_models
from ..services.settings.speech import (
    get_speech_settings,
    save_speech_settings,
    set_speech_auto_play,
    speech_connection,
)
from ..services.settings.speech_samples import read_sample
from ..services.settings.speech_voices import create_voice, list_voices, refresh_voices

settings_bp = Blueprint("settings", __name__)


def user_id() -> UUID:
    return UUID(get_jwt_identity())


@settings_bp.get("/speech/samples/<token>")
def speech_sample_route(token: str):
    content, content_type = read_sample(token)
    return Response(content, mimetype=content_type, headers={"Cache-Control": "no-store"})


@settings_bp.get("/speech")
@jwt_required()
def get_speech_route():
    return jsonify(get_speech_settings(user_id()))


@settings_bp.get("/speech/voices")
@jwt_required()
def list_speech_voices_route():
    return jsonify(list_voices(user_id()))


@settings_bp.post("/speech/voices")
@jwt_required()
def create_speech_voice_route():
    request.max_content_length = 3_000_000
    return jsonify(create_voice(user_id(), request.get_json(silent=True) or {})), 201


@settings_bp.post("/speech/voices/refresh")
@jwt_required()
def refresh_speech_voices_route():
    return jsonify(refresh_voices(user_id()))


@settings_bp.put("/speech")
@jwt_required()
def save_speech_route():
    return jsonify(save_speech_settings(user_id(), request.get_json(silent=True) or {}))


@settings_bp.put("/speech/auto-play")
@jwt_required()
def speech_auto_play_route():
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload.get("enabled"), bool):
        return jsonify({"error": {"code": "validation_error"}}), 422
    return jsonify(set_speech_auto_play(user_id(), payload["enabled"]))


@settings_bp.post("/speech/connection")
@jwt_required()
def speech_connection_route():
    return jsonify(speech_connection(user_id())), 200, {"Cache-Control": "no-store"}


@settings_bp.get("")
@jwt_required()
def get_settings_route():
    return jsonify(get_settings(user_id()))


@settings_bp.put("/profile")
@jwt_required()
def save_profile_route():
    display_name = str((request.get_json(silent=True) or {}).get("displayName") or "")
    save_profile(user_id(), display_name)
    return "", 204


@settings_bp.put("/avatar")
@jwt_required()
def save_avatar_route():
    payload = request.get_json(silent=True) or {}
    save_avatar(user_id(), str(payload.get("data") or ""), str(payload.get("contentType") or ""))
    return "", 204


@settings_bp.get("/avatar")
@jwt_required()
def get_avatar_route():
    content, content_type = get_avatar(user_id())
    return Response(
        content, mimetype=content_type, headers={"Cache-Control": "private, max-age=300"}
    )


@settings_bp.put("/models")
@jwt_required()
def save_models_route():
    models = (request.get_json(silent=True) or {}).get("models") or []
    save_models(user_id(), models)
    return "", 204


@settings_bp.get("/models")
@jwt_required()
def list_models_route():
    return jsonify(list_models(user_id()))


@settings_bp.put("/background-tasks")
@jwt_required()
def save_background_tasks_route():
    return jsonify(save_background_tasks(user_id(), request.get_json(silent=True) or {}))


@settings_bp.post("/models/test")
@jwt_required()
def test_model_route():
    return jsonify(test_model(user_id(), request.get_json(silent=True) or {}))
