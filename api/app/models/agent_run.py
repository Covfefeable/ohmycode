import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..extensions import db

if TYPE_CHECKING:
    from .agent_event import AgentEvent
    from .context_checkpoint import ContextCheckpoint


class AgentRun(db.Model):
    __tablename__ = "agent_runs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    model_configuration_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("model_configurations.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(32), default="running", index=True)
    last_event_sequence: Mapped[int] = mapped_column(Integer, default=0)
    error_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)

    events: Mapped[list["AgentEvent"]] = relationship(
        back_populates="run", cascade="all, delete-orphan", order_by="AgentEvent.sequence"
    )
    checkpoints: Mapped[list["ContextCheckpoint"]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )
