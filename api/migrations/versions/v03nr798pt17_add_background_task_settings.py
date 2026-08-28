"""add background task settings

Revision ID: v03nr798pt17
Revises: u92mq687os06
Create Date: 2026-08-29
"""

import sqlalchemy as sa
from alembic import op

revision = "v03nr798pt17"
down_revision = "u92mq687os06"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "background_task_settings",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("auto_summary_enabled", sa.Boolean(), nullable=False),
        sa.Column("auto_summary_model_id", sa.Uuid(), nullable=True),
        sa.Column("context_compaction_ratio", sa.Float(), nullable=False),
        sa.Column("context_compaction_model_id", sa.Uuid(), nullable=True),
        sa.Column("suggestions_enabled", sa.Boolean(), nullable=False),
        sa.Column("suggestions_model_id", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["auto_summary_model_id"], ["model_configurations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["context_compaction_model_id"], ["model_configurations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["suggestions_model_id"], ["model_configurations.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("user_id"),
    )


def downgrade() -> None:
    op.drop_table("background_task_settings")
