"""users

Revision ID: 0001
Revises:
Create Date: 2026-10-17
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("telegram_id", sa.BigInteger(), nullable=False),
        sa.Column("first_name", sa.String(255), nullable=False),
        sa.Column("last_name", sa.String(255)),
        sa.Column("username", sa.String(64)),
        sa.Column("language_code", sa.String(16)),
        sa.Column("photo_url", sa.Text()),
        sa.Column("is_premium_tg", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "notation",
            sa.Enum("letter", "solfege", name="notation_kind", native_enum=False, length=16),
        ),
        sa.Column(
            "notifications_enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column("is_blocked_bot", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("allows_write_to_pm", sa.Boolean()),
        sa.Column("bot_started_at", TZ),
        sa.Column("write_access_requested_at", TZ),
        sa.Column("tuner_opened_at", TZ),
        sa.Column("created_at", TZ, server_default=sa.func.now(), nullable=False),
        sa.Column("last_seen_at", TZ, server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("telegram_id", name="uq_users_telegram_id"),
    )


def downgrade() -> None:
    op.drop_table("users")
