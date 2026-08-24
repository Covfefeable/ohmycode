from sqlalchemy import text

from ...extensions import db
from ...integrations.redis_client import get_redis


def dependency_status() -> tuple[dict[str, str], bool]:
    checks: dict[str, str] = {}
    healthy = True

    try:
        db.session.execute(text("SELECT 1"))
        checks["postgres"] = "ok"
    except Exception:
        db.session.rollback()
        checks["postgres"] = "unavailable"
        healthy = False

    try:
        get_redis().ping()
        checks["redis"] = "ok"
    except Exception:
        checks["redis"] = "unavailable"
        healthy = False

    return checks, healthy

