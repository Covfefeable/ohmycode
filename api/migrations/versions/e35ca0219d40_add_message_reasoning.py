"""add message reasoning

Revision ID: e35ca0219d40
Revises: d24b9e108c3f
"""

import sqlalchemy as sa
from alembic import op

revision = "e35ca0219d40"
down_revision = "d24b9e108c3f"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("messages", sa.Column("reasoning", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("messages", "reasoning")
