"""Persist custom speech voices per user and provider workspace."""

import sqlalchemy as sa
from alembic import op

revision = "c70uy465ws84"
down_revision = "b69tx354vr73"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("speech_settings", "voice", existing_type=sa.String(100), type_=sa.String(255))
    op.create_table(
        "speech_voices",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("workspace_id", sa.String(100), nullable=False),
        sa.Column("voice_id", sa.String(255), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("target_model", sa.String(100), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("user_id", "workspace_id", "voice_id"),
    )
    op.create_index("ix_speech_voices_user_id", "speech_voices", ["user_id"])


def downgrade() -> None:
    op.drop_table("speech_voices")
    op.alter_column("speech_settings", "voice", existing_type=sa.String(255), type_=sa.String(100))
