"""add run usage and message run

Revision ID: g57ec243bf62
Revises: f46db132ae51
"""

from alembic import op
import sqlalchemy as sa

revision = "g57ec243bf62"
down_revision = "f46db132ae51"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("agent_runs") as batch_op:
        batch_op.add_column(sa.Column("input_tokens", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("output_tokens", sa.Integer(), nullable=True))
    with op.batch_alter_table("messages") as batch_op:
        batch_op.add_column(sa.Column("agent_run_id", sa.Uuid(), nullable=True))
        batch_op.create_index("ix_messages_agent_run_id", ["agent_run_id"], unique=False)
        batch_op.create_foreign_key(
            "fk_messages_agent_run_id_agent_runs", "agent_runs", ["agent_run_id"], ["id"], ondelete="SET NULL"
        )


def downgrade():
    with op.batch_alter_table("messages") as batch_op:
        batch_op.drop_constraint("fk_messages_agent_run_id_agent_runs", type_="foreignkey")
        batch_op.drop_index("ix_messages_agent_run_id")
        batch_op.drop_column("agent_run_id")
    with op.batch_alter_table("agent_runs") as batch_op:
        batch_op.drop_column("output_tokens")
        batch_op.drop_column("input_tokens")
