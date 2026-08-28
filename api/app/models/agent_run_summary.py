import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..extensions import db

if TYPE_CHECKING:
    from .agent_run import AgentRun


class AgentRunSummary(db.Model):
    __tablename__ = "agent_run_summaries"
    __table_args__ = (UniqueConstraint("run_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agent_runs.id", ondelete="CASCADE"), index=True
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    source_last_sequence: Mapped[int] = mapped_column(Integer)
    source_digest: Mapped[str] = mapped_column(String(64))
    source_size: Mapped[int] = mapped_column(Integer)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary_version: Mapped[int] = mapped_column(Integer, default=1)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    run: Mapped["AgentRun"] = relationship(back_populates="summary")
