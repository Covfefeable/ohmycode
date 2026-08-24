from uuid import UUID

from ...extensions import db
from ...models import ModelConfiguration


def models_for_user(user_id: UUID) -> list[ModelConfiguration]:
    return list(
        db.session.scalars(
            db.select(ModelConfiguration)
            .where(ModelConfiguration.user_id == user_id)
            .order_by(ModelConfiguration.position)
        )
    )


def get_model_configuration(user_id: UUID, model_id: str | None) -> ModelConfiguration | None:
    query = db.select(ModelConfiguration).where(ModelConfiguration.user_id == user_id)
    if model_id:
        try:
            query = query.where(ModelConfiguration.id == UUID(str(model_id)))
        except ValueError:
            return None
    else:
        query = query.order_by(ModelConfiguration.position)
    return db.session.scalar(query)
