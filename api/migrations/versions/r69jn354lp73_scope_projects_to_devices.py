"""scope projects to devices

Revision ID: r69jn354lp73
Revises: q58im243ko62
"""

import sqlalchemy as sa
from alembic import op

revision = "r69jn354lp73"
down_revision = "q58im243ko62"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "projects",
        sa.Column("device_id", sa.String(length=64), nullable=False, server_default="legacy"),
    )
    op.add_column(
        "projects",
        sa.Column(
            "device_name", sa.String(length=255), nullable=False, server_default="Legacy device"
        ),
    )
    op.create_index("ix_projects_device_id", "projects", ["device_id"])
    op.drop_constraint("uq_projects_user_path", "projects", type_="unique")
    op.create_unique_constraint(
        "uq_projects_user_device_path", "projects", ["user_id", "device_id", "path"]
    )
    op.alter_column("projects", "device_id", server_default=None)
    op.alter_column("projects", "device_name", server_default=None)


def downgrade():
    op.drop_constraint("uq_projects_user_device_path", "projects", type_="unique")
    op.create_unique_constraint("uq_projects_user_path", "projects", ["user_id", "path"])
    op.drop_index("ix_projects_device_id", table_name="projects")
    op.drop_column("projects", "device_name")
    op.drop_column("projects", "device_id")
