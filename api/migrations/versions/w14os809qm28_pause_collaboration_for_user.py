"""pause collaboration when an agent addresses the user

Revision ID: w14os809qm28
Revises: v03nr798pt17
Create Date: 2026-08-30
"""

import sqlalchemy as sa
from alembic import op

revision = "w14os809qm28"
down_revision = "v03nr798pt17"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "multi_agent_tasks",
        sa.Column("execution_queue", sa.JSON(), nullable=False, server_default="[]"),
    )
    op.alter_column("multi_agent_messages", "to_node_id", existing_type=sa.Uuid(), nullable=True)
    op.execute("UPDATE multi_agent_tasks SET status = 'waiting_user' WHERE status = 'completed'")
    op.execute("UPDATE multi_agent_messages SET to_node_id = NULL, message_type = 'message' WHERE message_type = 'final'")


def downgrade() -> None:
    op.execute("DELETE FROM multi_agent_messages WHERE to_node_id IS NULL")
    op.execute("UPDATE multi_agent_tasks SET status = 'completed' WHERE status = 'waiting_user'")
    op.alter_column("multi_agent_messages", "to_node_id", existing_type=sa.Uuid(), nullable=False)
    op.drop_column("multi_agent_tasks", "execution_queue")
