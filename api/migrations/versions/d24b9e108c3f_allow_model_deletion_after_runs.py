"""allow model deletion after runs

Revision ID: d24b9e108c3f
Revises: c13a8df07b2e
"""

from alembic import op

revision = "d24b9e108c3f"
down_revision = "c13a8df07b2e"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("agent_runs", "model_configuration_id", nullable=True)
    op.drop_constraint("agent_runs_model_configuration_id_fkey", "agent_runs", type_="foreignkey")
    op.create_foreign_key(
        "agent_runs_model_configuration_id_fkey",
        "agent_runs",
        "model_configurations",
        ["model_configuration_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade():
    op.drop_constraint("agent_runs_model_configuration_id_fkey", "agent_runs", type_="foreignkey")
    op.create_foreign_key(
        "agent_runs_model_configuration_id_fkey",
        "agent_runs",
        "model_configurations",
        ["model_configuration_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.alter_column("agent_runs", "model_configuration_id", nullable=False)
