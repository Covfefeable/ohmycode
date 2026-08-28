"""add turn summaries and checkpoint cursors

Revision ID: u92mq687os06
Revises: t81lp576nr95
Create Date: 2026-08-29
"""

import sqlalchemy as sa
from alembic import op

revision = "u92mq687os06"
down_revision = "t81lp576nr95"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DELETE FROM context_checkpoints")
    op.drop_column("context_checkpoints", "source_message_count")
    op.add_column(
        "context_checkpoints",
        sa.Column("covered_message_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "context_checkpoints",
        sa.Column("covered_run_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "context_checkpoints",
        sa.Column("covered_event_sequence", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_foreign_key(
        "fk_context_checkpoints_covered_message",
        "context_checkpoints",
        "messages",
        ["covered_message_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_context_checkpoints_covered_run",
        "context_checkpoints",
        "agent_runs",
        ["covered_run_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_table(
        "agent_run_summaries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("source_last_sequence", sa.Integer(), nullable=False),
        sa.Column("source_digest", sa.String(length=64), nullable=False),
        sa.Column("source_size", sa.Integer(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("summary_version", sa.Integer(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id"),
    )
    op.create_index(
        "ix_agent_run_summaries_conversation_id",
        "agent_run_summaries",
        ["conversation_id"],
    )
    op.create_index("ix_agent_run_summaries_run_id", "agent_run_summaries", ["run_id"])
    op.create_index("ix_agent_run_summaries_status", "agent_run_summaries", ["status"])


def downgrade() -> None:
    op.drop_table("agent_run_summaries")
    op.execute("DELETE FROM context_checkpoints")
    op.drop_constraint(
        "fk_context_checkpoints_covered_run", "context_checkpoints", type_="foreignkey"
    )
    op.drop_constraint(
        "fk_context_checkpoints_covered_message", "context_checkpoints", type_="foreignkey"
    )
    op.drop_column("context_checkpoints", "covered_event_sequence")
    op.drop_column("context_checkpoints", "covered_run_id")
    op.drop_column("context_checkpoints", "covered_message_id")
    op.add_column(
        "context_checkpoints",
        sa.Column("source_message_count", sa.Integer(), nullable=False),
    )
