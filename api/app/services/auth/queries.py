import uuid

from ...extensions import db
from ...models import User


def get_user(user_id: str) -> User | None:
    try:
        parsed_id = uuid.UUID(user_id)
    except ValueError:
        return None
    return db.session.get(User, parsed_id)


def serialize_user(user: User) -> dict[str, str]:
    return {
        "id": str(user.id),
        "email": user.email,
        "displayName": user.display_name,
        "createdAt": user.created_at.isoformat() if user.created_at else "",
    }
