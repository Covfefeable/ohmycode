import base64
import binascii
import hashlib
from uuid import UUID, uuid4

from ...extensions import db
from ...models import SkillPackage
from ..errors import ServiceError
from ..object_storage import delete_object, get_object, put_object
from .retrieval import sync_capability_index

MAX_SKILL_ARCHIVE_BYTES = 10 * 1024 * 1024


def _serialize(skill: SkillPackage) -> dict:
    return {
        "id": str(skill.id),
        "name": skill.name,
        "description": skill.description,
        "version": skill.version,
        "sha256": skill.sha256,
        "size": skill.size,
        "enabled": skill.enabled,
    }


def list_skills(user_id: UUID) -> list[dict]:
    skills = db.session.scalars(
        db.select(SkillPackage)
        .where(SkillPackage.user_id == user_id)
        .order_by(SkillPackage.created_at)
    )
    return [_serialize(skill) for skill in skills]


def save_skill(user_id: UUID, payload: dict) -> dict:
    name = str(payload.get("name") or "").strip()[:100]
    description = str(payload.get("description") or "").strip()[:4000]
    version = str(payload.get("version") or "1.0.0").strip()[:64]
    try:
        content = base64.b64decode(str(payload.get("archive") or ""), validate=True)
    except (binascii.Error, ValueError) as error:
        raise ServiceError("invalid_skill_archive", 422) from error
    if (
        not name
        or not content
        or len(content) > MAX_SKILL_ARCHIVE_BYTES
        or not content.startswith(b"PK")
    ):
        raise ServiceError("invalid_skill_archive", 422)
    digest = hashlib.sha256(content).hexdigest()
    existing = db.session.scalar(
        db.select(SkillPackage).where(SkillPackage.user_id == user_id, SkillPackage.name == name)
    )
    skill = existing or SkillPackage(id=uuid4(), user_id=user_id)
    key = f"skills/{user_id}/{skill.id}/{digest}.zip"
    put_object(key, content, "application/zip")
    previous_key = skill.archive_key if existing else None
    skill.name = name
    skill.description = description
    skill.version = version
    skill.archive_key = key
    skill.sha256 = digest
    skill.size = len(content)
    skill.enabled = bool(payload.get("enabled", True))
    db.session.add(skill)
    db.session.commit()
    sync_capability_index(user_id)
    if previous_key and previous_key != key:
        try:
            delete_object(previous_key)
        except ServiceError:
            pass
    return _serialize(skill)


def download_skill(user_id: UUID, skill_id: UUID) -> tuple[bytes, str]:
    skill = db.session.get(SkillPackage, skill_id)
    if not skill or skill.user_id != user_id:
        raise ServiceError("not_found", 404)
    content, _ = get_object(skill.archive_key)
    return content, skill.sha256


def delete_skill(user_id: UUID, skill_id: UUID) -> None:
    skill = db.session.get(SkillPackage, skill_id)
    if not skill or skill.user_id != user_id:
        raise ServiceError("not_found", 404)
    key = skill.archive_key
    db.session.delete(skill)
    db.session.commit()
    sync_capability_index(user_id)
    try:
        delete_object(key)
    except ServiceError:
        pass
