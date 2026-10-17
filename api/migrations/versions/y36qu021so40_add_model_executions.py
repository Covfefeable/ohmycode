"""Persist background model executions and replayable stream events."""

import sqlalchemy as sa
from alembic import op

revision = "y36qu021so40"
down_revision = "x25pt910rn39"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "model_executions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "run_id", sa.Uuid(), sa.ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("request_key", sa.String(64), nullable=False),
        sa.Column("step", sa.Integer(), nullable=False),
        sa.Column("parameters", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("last_sequence", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("run_id", "request_key"),
    )
    op.create_index("ix_model_executions_run_id", "model_executions", ["run_id"])
    op.create_index("ix_model_executions_status", "model_executions", ["status"])
    op.create_table(
        "model_stream_events",
        sa.Column(
            "execution_id",
            sa.Uuid(),
            sa.ForeignKey("model_executions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("sequence", sa.Integer(), primary_key=True),
        sa.Column("payload", sa.JSON(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("model_stream_events")
    op.drop_table("model_executions")
