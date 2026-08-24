from time import perf_counter
from uuid import UUID

import httpx
from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..extensions import db
from ..models import ModelConfiguration, User
from ..services.model_credentials import decrypt_api_key, encrypt_api_key

settings_bp = Blueprint("settings", __name__)


def user_id() -> UUID:
    return UUID(get_jwt_identity())


def models_for_user() -> list[ModelConfiguration]:
    return list(
        db.session.scalars(
            db.select(ModelConfiguration)
            .where(ModelConfiguration.user_id == user_id())
            .order_by(ModelConfiguration.position)
        )
    )


def serialize_model(item: ModelConfiguration) -> dict:
    return {
        "id": str(item.id),
        "name": item.name,
        "baseUrl": item.base_url,
        "model": item.model,
        "hasApiKey": bool(item.api_key_encrypted),
    }


@settings_bp.get("")
@jwt_required()
def get_settings():
    user = db.session.get(User, user_id())
    return jsonify(
        {
            "profile": {"displayName": user.display_name, "avatarDataUrl": None},
            "models": [serialize_model(item) for item in models_for_user()],
        }
    )


@settings_bp.put("/profile")
@jwt_required()
def save_profile():
    user = db.session.get(User, user_id())
    user.display_name = str((request.get_json(silent=True) or {}).get("displayName") or "").strip()[
        :100
    ]
    db.session.commit()
    return "", 204


@settings_bp.put("/models")
@jwt_required()
def save_models():
    inputs = (request.get_json(silent=True) or {}).get("models") or []
    existing = {str(item.id): item for item in models_for_user()}
    retained: set[str] = set()
    for position, payload in enumerate(inputs):
        item = existing.get(str(payload.get("id"))) or ModelConfiguration(
            id=UUID(str(payload["id"])), user_id=user_id()
        )
        item.name = str(payload.get("name") or "").strip()[:100]
        item.base_url = str(payload.get("baseUrl") or "").strip().rstrip("/")[:1024]
        item.model = str(payload.get("model") or "").strip()[:200]
        item.position = position
        api_key = str(payload.get("apiKey") or "").strip()
        if api_key:
            item.api_key_encrypted = encrypt_api_key(api_key)
        if not item.api_key_encrypted:
            return jsonify({"error": {"code": "missing_api_key"}}), 422
        db.session.add(item)
        retained.add(str(item.id))
    for item_id, item in existing.items():
        if item_id not in retained:
            db.session.delete(item)
    db.session.commit()
    return "", 204


@settings_bp.post("/models/test")
@jwt_required()
def test_model():
    payload = request.get_json(silent=True) or {}
    stored = next(
        (item for item in models_for_user() if str(item.id) == str(payload.get("id"))), None
    )
    api_key = str(payload.get("apiKey") or "").strip() or (
        decrypt_api_key(stored.api_key_encrypted) if stored else ""
    )
    if not api_key:
        return jsonify({"ok": False, "message": "missing_api_key"})
    try:
        started = perf_counter()
        response = httpx.get(
            f"{str(payload.get('baseUrl') or '').rstrip('/')}/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=15,
        )
        if not response.is_success:
            return jsonify({"ok": False, "message": f"http_{response.status_code}"})
        return jsonify({"ok": True, "latencyMs": round((perf_counter() - started) * 1000)})
    except httpx.HTTPError:
        return jsonify({"ok": False, "message": "connection_failed"})
