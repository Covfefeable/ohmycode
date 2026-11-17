"""Add the operation approval background model."""

import sqlalchemy as sa
from alembic import op

revision = "e92wa687yu06"
down_revision = "d81vz576xt95"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "background_task_settings",
        sa.Column("operation_approval_model_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_background_approval_model",
        "background_task_settings",
        "model_configurations",
        ["operation_approval_model_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_background_approval_model", "background_task_settings", type_="foreignkey"
    )
    op.drop_column("background_task_settings", "operation_approval_model_id")
