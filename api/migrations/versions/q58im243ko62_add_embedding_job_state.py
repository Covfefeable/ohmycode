"""add embedding job state

Revision ID: q58im243ko62
Revises: p47hl132jn51
"""

import sqlalchemy as sa
from alembic import op

revision = "q58im243ko62"
down_revision = "p47hl132jn51"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "retrieval_documents",
        sa.Column("embedding_status", sa.String(length=16), nullable=False, server_default="pending"),
    )
    op.add_column(
        "retrieval_documents",
        sa.Column("embedding_attempts", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("retrieval_documents", sa.Column("embedding_error", sa.Text(), nullable=True))
    op.add_column(
        "retrieval_documents",
        sa.Column("embedding_lease_until", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "retrieval_documents",
        sa.Column("embedding_updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_retrieval_documents_embedding_status",
        "retrieval_documents",
        ["embedding_status"],
    )
    op.alter_column("retrieval_documents", "embedding_status", server_default=None)
    op.alter_column("retrieval_documents", "embedding_attempts", server_default=None)


def downgrade():
    op.drop_index("ix_retrieval_documents_embedding_status", table_name="retrieval_documents")
    op.drop_column("retrieval_documents", "embedding_updated_at")
    op.drop_column("retrieval_documents", "embedding_lease_until")
    op.drop_column("retrieval_documents", "embedding_error")
    op.drop_column("retrieval_documents", "embedding_attempts")
    op.drop_column("retrieval_documents", "embedding_status")
