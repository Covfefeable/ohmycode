"""add capability retrieval

Revision ID: p47hl132jn51
Revises: o36gk021im40
"""

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

revision = "p47hl132jn51"
down_revision = "o36gk021im40"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "retrieval_documents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("capability_id", sa.Uuid(), nullable=False),
        sa.Column("item_key", sa.String(length=255), nullable=False),
        sa.Column("capability_name", sa.String(length=100), nullable=False),
        sa.Column("capability_identifier", sa.String(length=64), nullable=True),
        sa.Column("item_name", sa.String(length=255), nullable=False),
        sa.Column("item_description", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("embedding", Vector(), nullable=True),
        sa.Column("embedding_model", sa.String(length=255), nullable=True),
        sa.Column("embedding_version", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "kind",
            "capability_id",
            "item_key",
            name="uq_retrieval_document_item",
        ),
    )
    op.create_index("ix_retrieval_documents_user_id", "retrieval_documents", ["user_id"])
    op.create_index("ix_retrieval_documents_kind", "retrieval_documents", ["kind"])
    op.create_index(
        "ix_retrieval_documents_capability_id",
        "retrieval_documents",
        ["capability_id"],
    )


def downgrade():
    op.drop_table("retrieval_documents")
