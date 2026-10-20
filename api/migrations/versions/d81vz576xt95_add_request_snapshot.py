"""Keep the latest provider request snapshot for context debugging."""

import sqlalchemy as sa
from alembic import op

revision = "d81vz576xt95"
down_revision = "c70uy465ws84"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("model_executions", sa.Column("request_snapshot", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("model_executions", "request_snapshot")
