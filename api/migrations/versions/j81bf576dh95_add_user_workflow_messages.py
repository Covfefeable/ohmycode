"""add user workflow messages

Revision ID: j81bf576dh95
Revises: i70ae465dg84
"""
from alembic import op
import sqlalchemy as sa

revision = "j81bf576dh95"
down_revision = "i70ae465dg84"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("multi_agent_messages") as batch_op:
        batch_op.alter_column("from_node_id", existing_type=sa.UUID(), nullable=True)
        batch_op.add_column(sa.Column("sender_type", sa.String(length=16), nullable=False, server_default="agent"))


def downgrade():
    with op.batch_alter_table("multi_agent_messages") as batch_op:
        batch_op.drop_column("sender_type")
        batch_op.alter_column("from_node_id", existing_type=sa.UUID(), nullable=False)
