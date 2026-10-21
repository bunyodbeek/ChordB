"""admin panel: premium end date, payments, premium history, user events, search misses

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-21
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TZ = sa.DateTime(timezone=True)


def _user_fk(name: str, ondelete: str = "CASCADE", nullable: bool = False) -> sa.Column:
    return sa.Column(
        name, sa.BigInteger(), sa.ForeignKey("users.id", ondelete=ondelete), nullable=nullable
    )


def _enum(name: str, *values: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, length=32)


def upgrade() -> None:
    op.add_column("users", sa.Column("premium_until", TZ))

    op.create_table(
        "payments",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        _user_fk("user_id"),
        sa.Column("plan", sa.String(16), nullable=False),
        sa.Column("days", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("receipt", sa.LargeBinary(), nullable=False),
        sa.Column("receipt_type", sa.String(32), nullable=False),
        sa.Column(
            "status",
            _enum("payment_status", "pending", "approved", "rejected"),
            server_default=sa.text("'pending'"),
            nullable=False,
        ),
        sa.Column("note", sa.Text()),
        _user_fk("decided_by", "SET NULL", nullable=True),
        sa.Column("decided_at", TZ),
        sa.Column("created_at", TZ, server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_payments_user_created", "payments", ["user_id", "created_at"])
    # At most one request waiting per user.
    op.create_index(
        "ux_payments_one_pending",
        "payments",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )

    op.create_table(
        "premium_events",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        _user_fk("user_id"),
        sa.Column(
            "kind", _enum("premium_event", "granted", "paid", "rejected", "revoked"), nullable=False
        ),
        sa.Column("days", sa.Integer()),
        sa.Column(
            "payment_id", sa.BigInteger(), sa.ForeignKey("payments.id", ondelete="SET NULL")
        ),
        _user_fk("admin_id", "SET NULL", nullable=True),
        sa.Column("note", sa.Text()),
        sa.Column("created_at", TZ, server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_premium_events_user", "premium_events", ["user_id", "created_at"])

    op.create_table(
        "user_events",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        _user_fk("user_id"),
        sa.Column(
            "type",
            _enum(
                "user_event_type",
                "app_opened", "tuner_opened", "song_opened", "premium_viewed", "deep_link",
            ),
            nullable=False,
        ),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("ref", sa.String(32), server_default=sa.text("''"), nullable=False),
        sa.Column("created_at", TZ, server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "type", "day", "ref", name="uq_user_events_daily"),
    )
    op.create_index("ix_user_events_type_day", "user_events", ["type", "day"])

    op.create_table(
        "search_misses",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        _user_fk("user_id"),
        sa.Column("query", sa.String(100), nullable=False),
        sa.Column("created_at", TZ, server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_search_misses_created", "search_misses", ["created_at"])


def downgrade() -> None:
    op.drop_table("search_misses")
    op.drop_table("user_events")
    op.drop_table("premium_events")
    op.drop_table("payments")
    op.drop_column("users", "premium_until")
