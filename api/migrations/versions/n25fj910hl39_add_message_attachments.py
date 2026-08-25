"""add message attachments

Revision ID: n25fj910hl39
Revises: m14ei809gk28
"""

from alembic import op
import sqlalchemy as sa


revision = "n25fj910hl39"
down_revision = "m14ei809gk28"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("messages", sa.Column("attachments", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("messages", "attachments")
