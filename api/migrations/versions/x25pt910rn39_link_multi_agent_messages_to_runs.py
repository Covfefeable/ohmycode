"""link multi-agent messages to runs

Revision ID: x25pt910rn39
Revises: w14os809qm28
Create Date: 2026-08-30
"""

import sqlalchemy as sa
from alembic import op

revision = "x25pt910rn39"
down_revision = "w14os809qm28"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("multi_agent_messages", sa.Column("run_id", sa.Uuid(), nullable=True))
    op.create_index(
        op.f("ix_multi_agent_messages_run_id"), "multi_agent_messages", ["run_id"], unique=False
    )
    with op.batch_alter_table("multi_agent_messages") as batch_op:
        batch_op.create_foreign_key(
            "fk_multi_agent_messages_run_id_agent_runs",
            "agent_runs",
            ["run_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("multi_agent_messages") as batch_op:
        batch_op.drop_constraint(
            "fk_multi_agent_messages_run_id_agent_runs", type_="foreignkey"
        )
    op.drop_index(op.f("ix_multi_agent_messages_run_id"), table_name="multi_agent_messages")
    op.drop_column("multi_agent_messages", "run_id")
