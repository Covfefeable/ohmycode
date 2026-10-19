"""Add per-user speech credentials and preferences."""

import sqlalchemy as sa
from alembic import op

revision = "b69tx354vr73"
down_revision = "a58sw243uq62"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "speech_settings",
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("workspace_id", sa.String(100), nullable=False),
        sa.Column("api_key_encrypted", sa.LargeBinary(), nullable=False),
        sa.Column("voice", sa.String(100), nullable=False),
        sa.Column("auto_play", sa.Boolean(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("speech_settings")
