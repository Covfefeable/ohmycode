"""Align metadata timestamp constraints with the persistence models."""

import sqlalchemy as sa
from alembic import op

revision = "z47rv132tp51"
down_revision = "y36qu021so40"
branch_labels = None
depends_on = None

TABLES = ("agent_run_summaries", "mcp_servers", "retrieval_documents", "skill_packages")


def upgrade() -> None:
    for name in TABLES:
        table = sa.table(name, sa.column("created_at"), sa.column("updated_at"))
        op.execute(
            table.update()
            .where(sa.or_(table.c.created_at.is_(None), table.c.updated_at.is_(None)))
            .values(
                created_at=sa.func.coalesce(table.c.created_at, table.c.updated_at, sa.func.now()),
                updated_at=sa.func.coalesce(table.c.updated_at, table.c.created_at, sa.func.now()),
            )
        )
        for column in ("created_at", "updated_at"):
            op.alter_column(name, column, existing_type=sa.DateTime(timezone=True), nullable=False)


def downgrade() -> None:
    for name in reversed(TABLES):
        for column in ("created_at", "updated_at"):
            op.alter_column(name, column, existing_type=sa.DateTime(timezone=True), nullable=True)
