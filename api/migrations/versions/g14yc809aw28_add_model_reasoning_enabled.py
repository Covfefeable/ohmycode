"""Add an explicit reasoning effort opt-in."""

import sqlalchemy as sa
from alembic import op

revision = "g14yc809aw28"
down_revision = "f03xb798zv17"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "model_configurations",
        sa.Column("reasoning_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("model_configurations", "reasoning_enabled")
