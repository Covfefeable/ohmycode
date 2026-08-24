"""make collaborations reusable

Revision ID: i70ae465dg84
Revises: h68fd354ca73
"""

import sqlalchemy as sa
from alembic import op

revision = "i70ae465dg84"
down_revision = "h68fd354ca73"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("multi_agents") as batch_op:
        batch_op.add_column(sa.Column("description", sa.Text(), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("division", sa.Text(), nullable=False, server_default=""))
        batch_op.add_column(
            sa.Column("template_flow", sa.JSON(), nullable=False, server_default="{}")
        )
        batch_op.alter_column("project_id", existing_type=sa.UUID(), nullable=True)
        batch_op.drop_constraint("multi_agents_project_id_fkey", type_="foreignkey")
        batch_op.create_foreign_key(
            "multi_agents_project_id_fkey", "projects", ["project_id"], ["id"], ondelete="SET NULL"
        )
    with op.batch_alter_table("multi_agent_tasks") as batch_op:
        batch_op.add_column(sa.Column("project_id", sa.UUID(), nullable=True))
        batch_op.create_index("ix_multi_agent_tasks_project_id", ["project_id"])
        batch_op.create_foreign_key(
            "multi_agent_tasks_project_id_fkey",
            "projects",
            ["project_id"],
            ["id"],
            ondelete="CASCADE",
        )
    op.execute(
        "UPDATE multi_agent_tasks SET project_id = multi_agents.project_id "
        "FROM multi_agents WHERE multi_agent_tasks.agent_id = multi_agents.id"
    )
    with op.batch_alter_table("multi_agent_tasks") as batch_op:
        batch_op.alter_column("project_id", existing_type=sa.UUID(), nullable=False)
    with op.batch_alter_table("multi_agent_nodes") as batch_op:
        batch_op.add_column(sa.Column("model_configuration_id", sa.UUID(), nullable=True))
        batch_op.create_index(
            "ix_multi_agent_nodes_model_configuration_id", ["model_configuration_id"]
        )
        batch_op.create_foreign_key(
            "multi_agent_nodes_model_configuration_id_fkey",
            "model_configurations",
            ["model_configuration_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade():
    with op.batch_alter_table("multi_agent_nodes") as batch_op:
        batch_op.drop_constraint(
            "multi_agent_nodes_model_configuration_id_fkey", type_="foreignkey"
        )
        batch_op.drop_index("ix_multi_agent_nodes_model_configuration_id")
        batch_op.drop_column("model_configuration_id")
    with op.batch_alter_table("multi_agent_tasks") as batch_op:
        batch_op.drop_constraint("multi_agent_tasks_project_id_fkey", type_="foreignkey")
        batch_op.drop_index("ix_multi_agent_tasks_project_id")
        batch_op.drop_column("project_id")
    with op.batch_alter_table("multi_agents") as batch_op:
        batch_op.drop_constraint("multi_agents_project_id_fkey", type_="foreignkey")
        batch_op.create_foreign_key(
            "multi_agents_project_id_fkey", "projects", ["project_id"], ["id"], ondelete="CASCADE"
        )
        batch_op.alter_column("project_id", existing_type=sa.UUID(), nullable=False)
        batch_op.drop_column("template_flow")
        batch_op.drop_column("division")
        batch_op.drop_column("description")
