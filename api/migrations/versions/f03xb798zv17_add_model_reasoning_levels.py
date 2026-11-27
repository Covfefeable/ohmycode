"""Store configurable model reasoning levels."""

import sqlalchemy as sa
from alembic import op

revision = "f03xb798zv17"
down_revision = "e92wa687yu06"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "model_configurations",
        sa.Column("reasoning_levels", sa.JSON(), nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_column("model_configurations", "reasoning_levels")
