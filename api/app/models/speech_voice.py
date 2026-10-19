import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from ..extensions import db


class SpeechVoice(db.Model):
    __tablename__ = "speech_voices"
    __table_args__ = (db.UniqueConstraint("user_id", "workspace_id", "voice_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    workspace_id: Mapped[str] = mapped_column(String(100))
    voice_id: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(100))
    target_model: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(32), default="DEPLOYING")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
