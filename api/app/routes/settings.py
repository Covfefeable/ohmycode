from uuid import UUID

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..services.settings import get_settings, save_models, save_profile, test_model

settings_bp = Blueprint("settings", __name__)


def user_id() -> UUID:
    return UUID(get_jwt_identity())


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


@settings_bp.put("/models")
@jwt_required()
def save_models_route():
    models = (request.get_json(silent=True) or {}).get("models") or []
    save_models(user_id(), models)
    return "", 204


@settings_bp.post("/models/test")
@jwt_required()
def test_model_route():
    return jsonify(test_model(user_id(), request.get_json(silent=True) or {}))
