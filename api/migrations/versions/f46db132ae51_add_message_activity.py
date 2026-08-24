"""add message activity

Revision ID: f46db132ae51
Revises: e35ca0219d40
"""

import sqlalchemy as sa
from alembic import op

revision = "f46db132ae51"
down_revision = "e35ca0219d40"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("messages", sa.Column("activity", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("messages", "activity")
