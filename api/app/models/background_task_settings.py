import uuid

from sqlalchemy import Boolean, Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from ..extensions import db


class BackgroundTaskSettings(db.Model):
    __tablename__ = "background_task_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    auto_summary_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    auto_summary_model_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("model_configurations.id", ondelete="SET NULL"), nullable=True
    )
    context_compaction_ratio: Mapped[float] = mapped_column(Float, default=0.70)
    context_compaction_model_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("model_configurations.id", ondelete="SET NULL"), nullable=True
    )
    suggestions_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    suggestions_model_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("model_configurations.id", ondelete="SET NULL"), nullable=True
    )
