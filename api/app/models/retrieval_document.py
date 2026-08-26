import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from ..extensions import db


class RetrievalDocument(db.Model):
    __tablename__ = "retrieval_documents"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "kind",
            "capability_id",
            "item_key",
            name="uq_retrieval_document_item",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(32), index=True)
    capability_id: Mapped[uuid.UUID] = mapped_column(index=True)
    item_key: Mapped[str] = mapped_column(String(255))
    capability_name: Mapped[str] = mapped_column(String(100))
    capability_identifier: Mapped[str | None] = mapped_column(String(64), nullable=True)
    item_name: Mapped[str] = mapped_column(String(255))
    item_description: Mapped[str] = mapped_column(Text, default="")
    content: Mapped[str] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(String(64))
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(), nullable=True)
    embedding_model: Mapped[str | None] = mapped_column(String(255), nullable=True)
    embedding_version: Mapped[str | None] = mapped_column(String(255), nullable=True)
    embedding_status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    embedding_attempts: Mapped[int] = mapped_column(Integer, default=0)
    embedding_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    embedding_lease_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    embedding_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
