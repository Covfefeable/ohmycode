"""add agent run tool snapshot

Revision ID: s70ko465mq84
Revises: r69jn354lp73
"""

import sqlalchemy as sa
from alembic import op

revision = "s70ko465mq84"
down_revision = "r69jn354lp73"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "agent_runs",
        sa.Column("tool_snapshot", sa.JSON(), nullable=False, server_default="[]"),
    )
    op.alter_column("agent_runs", "tool_snapshot", server_default=None)


def downgrade():
    op.drop_column("agent_runs", "tool_snapshot")
