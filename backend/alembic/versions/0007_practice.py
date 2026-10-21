"""practice: daily steps, streaks, game results, personal bests, chord collection

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-21
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TZ = sa.DateTime(timezone=True)
QUALITIES = ("maj", "min", "7", "maj7", "m7", "dim", "aug", "sus2", "sus4")


def _user_fk(primary_key: bool = False) -> sa.Column:
    return sa.Column(
        "user_id",
        sa.BigInteger(),
        sa.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        primary_key=primary_key,
    )


def _enum(name: str, *values: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False, length=32)


def upgrade() -> None:
    op.add_column("users", sa.Column("timezone", sa.String(64)))

    op.create_table(
        "practice_days",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        _user_fk(),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("steps_done", JSONB(), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("completed", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("completed_at", TZ),
        sa.Column("updated_at", TZ, server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "date", name="uq_practice_days_user_date"),
    )

    op.create_table(
        "streaks",
        _user_fk(primary_key=True),
        sa.Column("current", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("best", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("last_practice_date", sa.Date()),
        sa.Column("freezes_left", sa.SmallInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("freezes_month", sa.Date()),
    )

    op.create_table(
        "game_results",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        _user_fk(),
        sa.Column("game", _enum("game", "chord_switch", "ear_test"), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("details", JSONB(), nullable=False),
        sa.Column("created_at", TZ, server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_game_results_user_created", "game_results", ["user_id", "created_at"])

    op.create_table(
        "personal_bests",
        _user_fk(primary_key=True),
        sa.Column("game", _enum("game", "chord_switch", "ear_test"), primary_key=True),
        sa.Column("chain_key", sa.String(64), primary_key=True),
        sa.Column("value", sa.Integer(), nullable=False),
        sa.Column("updated_at", TZ, server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "chord_collection",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        _user_fk(),
        sa.Column("root", sa.SmallInteger(), nullable=False),
        sa.Column("quality", _enum("chord_quality", *QUALITIES), nullable=False),
        sa.Column("mode", _enum("unlock_mode", "played", "listened"), nullable=False),
        sa.Column("unlocked_at", TZ, server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "root", "quality", name="uq_chord_collection_chord"),
        sa.CheckConstraint("root BETWEEN 0 AND 11", name="ck_chord_collection_root"),
    )


def downgrade() -> None:
    op.drop_table("chord_collection")
    op.drop_table("personal_bests")
    op.drop_table("game_results")
    op.drop_table("streaks")
    op.drop_table("practice_days")
    op.drop_column("users", "timezone")
