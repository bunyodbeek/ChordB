"""notifications

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-18
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "type",
            sa.Enum(
                "welcome_followup",
                "weekly_reminder",
                "direct",
                "broadcast",
                name="notification_type",
                native_enum=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "sent", "blocked", "failed",
                name="notification_status",
                native_enum=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column(
            "sent_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("telegram_message_id", sa.BigInteger()),
        sa.Column("error", sa.Text()),
    )
    op.create_index("ix_notifications_user_type", "notifications", ["user_id", "type"])


def downgrade() -> None:
    op.drop_index("ix_notifications_user_type", table_name="notifications")
    op.drop_table("notifications")
