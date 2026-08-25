"""add model vision support

Revision ID: m14ei809gk28
Revises: l03dh798fj17
"""

import sqlalchemy as sa
from alembic import op

revision = "m14ei809gk28"
down_revision = "l03dh798fj17"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "model_configurations",
        sa.Column("supports_vision", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade():
    op.drop_column("model_configurations", "supports_vision")
