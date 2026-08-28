"""add collaboration execution limit

Revision ID: t81lp576nr95
Revises: s70ko465mq84
Create Date: 2026-08-28
"""

import sqlalchemy as sa
from alembic import op

revision = "t81lp576nr95"
down_revision = "s70ko465mq84"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "multi_agent_tasks",
        sa.Column("execution_limit", sa.Integer(), nullable=False, server_default="12"),
    )
    op.add_column(
        "multi_agent_tasks",
        sa.Column("execution_count", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("multi_agent_tasks", "execution_count")
    op.drop_column("multi_agent_tasks", "execution_limit")
