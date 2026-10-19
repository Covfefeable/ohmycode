import uuid

from sqlalchemy import Boolean, ForeignKey, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from ..extensions import db


class SpeechSettings(db.Model):
    __tablename__ = "speech_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    workspace_id: Mapped[str] = mapped_column(String(100))
    api_key_encrypted: Mapped[bytes] = mapped_column(LargeBinary)
    voice: Mapped[str] = mapped_column(String(255), default="longanhuan_v3.1")
    auto_play: Mapped[bool] = mapped_column(Boolean, default=False)
