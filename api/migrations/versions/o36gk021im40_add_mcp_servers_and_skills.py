"""add mcp servers and skills

Revision ID: o36gk021im40
Revises: n25fj910hl39
"""

import sqlalchemy as sa
from alembic import op

revision = "o36gk021im40"
down_revision = "n25fj910hl39"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("avatar_object_key", sa.String(length=255), nullable=True))
    op.create_table(
        "mcp_servers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("identifier", sa.String(length=64), nullable=False),
        sa.Column("transport", sa.String(length=16), nullable=False),
        sa.Column("configuration_encrypted", sa.LargeBinary(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("tools", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "identifier", name="uq_mcp_user_identifier"),
    )
    op.create_index("ix_mcp_servers_user_id", "mcp_servers", ["user_id"])
    op.create_table(
        "skill_packages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("version", sa.String(length=64), nullable=False),
        sa.Column("archive_key", sa.String(length=255), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("archive_key"),
        sa.UniqueConstraint("user_id", "name", name="uq_skill_user_name"),
    )
    op.create_index("ix_skill_packages_user_id", "skill_packages", ["user_id"])


def downgrade():
    op.drop_table("skill_packages")
    op.drop_table("mcp_servers")
    op.drop_column("users", "avatar_object_key")
