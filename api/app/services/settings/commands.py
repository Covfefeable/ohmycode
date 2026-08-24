from datetime import UTC, datetime, timedelta
from time import perf_counter
from uuid import UUID

import httpx
from sqlalchemy import or_

from ...extensions import db
from ...models import AgentRun, Conversation, ModelConfiguration, Project, User
from ..errors import ServiceError
from ..model_credentials import decrypt_api_key, encrypt_api_key
from .queries import models_for_user


def serialize_model(item: ModelConfiguration) -> dict:
    return {
        "id": str(item.id),
        "name": item.name,
        "baseUrl": item.base_url,
        "model": item.model,
        "contextLength": item.context_length,
        "hasApiKey": bool(item.api_key_encrypted),
    }


def get_settings(user_id: UUID) -> dict:
    user = db.session.get(User, user_id)
    if not user:
        raise ServiceError("not_found", 404)
    since = datetime.now(UTC) - timedelta(days=364)
    runs = (
        db.session.query(AgentRun)
        .join(Conversation, AgentRun.conversation_id == Conversation.id)
        .join(Project, Conversation.project_id == Project.id)
        .filter(
            Project.user_id == user_id,
            AgentRun.completed_at >= since,
            or_(AgentRun.input_tokens.is_not(None), AgentRun.output_tokens.is_not(None)),
        )
        .all()
    )
    usage_by_day: dict[str, int] = {}
    for run in runs:
        day = run.completed_at.date().isoformat()
        usage_by_day[day] = usage_by_day.get(day, 0) + (run.input_tokens or 0) + (
            run.output_tokens or 0
        )
    return {
        "profile": {"displayName": user.display_name, "avatarDataUrl": None},
        "models": [serialize_model(item) for item in models_for_user(user_id)],
        "tokenUsage": [
            {"date": day, "tokens": tokens} for day, tokens in sorted(usage_by_day.items())
        ],
    }


def save_profile(user_id: UUID, display_name: str) -> None:
    user = db.session.get(User, user_id)
    if not user:
        raise ServiceError("not_found", 404)
    user.display_name = display_name.strip()[:100]
    db.session.commit()


def save_models(user_id: UUID, inputs: list[dict]) -> None:
    existing = {str(item.id): item for item in models_for_user(user_id)}
    retained: set[str] = set()
    for position, payload in enumerate(inputs):
        try:
            item_id = UUID(str(payload["id"]))
        except (KeyError, ValueError) as error:
            raise ServiceError("validation_error", 422) from error
        item = existing.get(str(item_id)) or ModelConfiguration(id=item_id, user_id=user_id)
        item.name = str(payload.get("name") or "").strip()[:100]
        item.base_url = str(payload.get("baseUrl") or "").strip().rstrip("/")[:1024]
        item.model = str(payload.get("model") or "").strip()[:200]
        try:
            item.context_length = int(payload.get("contextLength") or 262_144)
        except (TypeError, ValueError) as error:
            raise ServiceError("validation_error", 422) from error
        item.position = position
        api_key = str(payload.get("apiKey") or "").strip()
        if api_key:
            item.api_key_encrypted = encrypt_api_key(api_key)
        if (
            not item.name
            or not item.base_url
            or not item.model
            or not item.api_key_encrypted
            or not 1_024 <= item.context_length <= 10_000_000
        ):
            raise ServiceError("validation_error", 422)
        db.session.add(item)
        retained.add(str(item.id))
    for item_id, item in existing.items():
        if item_id not in retained:
            db.session.delete(item)
    db.session.commit()


def test_model(user_id: UUID, payload: dict) -> dict:
    stored = next(
        (item for item in models_for_user(user_id) if str(item.id) == str(payload.get("id"))), None
    )
    api_key = str(payload.get("apiKey") or "").strip() or (
        decrypt_api_key(stored.api_key_encrypted) if stored else ""
    )
    if not api_key:
        return {"ok": False, "message": "missing_api_key"}
    try:
        started = perf_counter()
        response = httpx.get(
            f"{str(payload.get('baseUrl') or '').rstrip('/')}/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=15,
        )
        if not response.is_success:
            return {"ok": False, "message": f"http_{response.status_code}"}
        return {"ok": True, "latencyMs": round((perf_counter() - started) * 1000)}
    except httpx.HTTPError:
        return {"ok": False, "message": "connection_failed"}
