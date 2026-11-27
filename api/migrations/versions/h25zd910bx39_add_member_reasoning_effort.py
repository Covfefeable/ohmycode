"""Persist reasoning effort for collaboration members and background tasks."""

import sqlalchemy as sa
from alembic import op

revision = "h25zd910bx39"
down_revision = "g14yc809aw28"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "background_task_settings",
        sa.Column("reasoning_efforts", sa.JSON(), nullable=False, server_default="{}"),
    )
    op.add_column(
        "multi_agent_nodes",
        sa.Column("reasoning_effort", sa.String(100), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("background_task_settings", "reasoning_efforts")
    op.drop_column("multi_agent_nodes", "reasoning_effort")
