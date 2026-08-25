"""finalize group collaboration schema

Revision ID: l03dh798fj17
Revises: k92cg687ei06
"""

import sqlalchemy as sa
from alembic import op

revision = "l03dh798fj17"
down_revision = "k92cg687ei06"
branch_labels = None
depends_on = None


def upgrade():
    columns = {
        item["name"] for item in sa.inspect(op.get_bind()).get_columns("multi_agent_messages")
    }
    if "sequence" not in columns:
        with op.batch_alter_table("multi_agent_messages") as batch_op:
            batch_op.add_column(
                sa.Column("sequence", sa.Integer(), nullable=False, server_default="0")
            )
        op.execute("""
            WITH numbered AS (
                SELECT id, row_number() OVER (
                    PARTITION BY task_id ORDER BY created_at, id
                ) AS value
                FROM multi_agent_messages
            )
            UPDATE multi_agent_messages AS message SET sequence = numbered.value
            FROM numbered WHERE message.id = numbered.id
        """)
        with op.batch_alter_table("multi_agent_messages") as batch_op:
            batch_op.create_unique_constraint(
                "uq_multi_agent_messages_task_sequence", ["task_id", "sequence"]
            )
    with op.batch_alter_table("multi_agent_messages") as batch_op:
        batch_op.drop_constraint("multi_agent_messages_reply_to_id_fkey", type_="foreignkey")
        batch_op.drop_column("reply_to_id")
        batch_op.drop_column("expects_reply")
    with op.batch_alter_table("multi_agents") as batch_op:
        batch_op.alter_column("template_flow", new_column_name="template_team")
        batch_op.drop_index("ix_multi_agents_project_id")
        batch_op.drop_constraint("multi_agents_project_id_fkey", type_="foreignkey")
        batch_op.drop_column("project_id")


def downgrade():
    with op.batch_alter_table("multi_agents") as batch_op:
        batch_op.add_column(sa.Column("project_id", sa.UUID(), nullable=True))
        batch_op.create_foreign_key(
            "multi_agents_project_id_fkey",
            "projects",
            ["project_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index("ix_multi_agents_project_id", ["project_id"])
        batch_op.alter_column("template_team", new_column_name="template_flow")
    with op.batch_alter_table("multi_agent_messages") as batch_op:
        batch_op.add_column(
            sa.Column("expects_reply", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.add_column(sa.Column("reply_to_id", sa.UUID(), nullable=True))
        batch_op.create_foreign_key(
            "multi_agent_messages_reply_to_id_fkey",
            "multi_agent_messages",
            ["reply_to_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.drop_constraint("uq_multi_agent_messages_task_sequence", type_="unique")
        batch_op.drop_column("sequence")
