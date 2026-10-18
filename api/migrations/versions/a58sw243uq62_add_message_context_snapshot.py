"""Preserve independent model context when branching conversations."""

import sqlalchemy as sa
from alembic import op

revision = "a58sw243uq62"
down_revision = "z47rv132tp51"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("context_snapshot", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("messages", "context_snapshot")
