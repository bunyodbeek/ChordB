"""ear test levels: progress per user and server-checked runs

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-23
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TZ = sa.DateTime(timezone=True)


def _user_fk(primary_key: bool = False) -> sa.Column:
    return sa.Column(
        "user_id",
        sa.BigInteger(),
        sa.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        primary_key=primary_key,
    )


def upgrade() -> None:
    op.create_table(
        "ear_progress",
        _user_fk(primary_key=True),
        sa.Column("max_unlocked_level", sa.SmallInteger(), server_default=sa.text("1"), nullable=False),
        sa.Column("best_score_per_level", JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("perfect_streak", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("updated_at", TZ, server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("max_unlocked_level BETWEEN 1 AND 8", name="ck_ear_progress_level"),
    )

    op.create_table(
        "ear_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        _user_fk(),
        sa.Column("level", sa.SmallInteger(), nullable=False),
        sa.Column("questions", JSONB(), nullable=False),
        sa.Column("answers", JSONB(), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("score", sa.SmallInteger()),
        sa.Column(
            "status",
            sa.Enum("active", "finished", "expired", name="ear_run_status", native_enum=False, length=32),
            server_default=sa.text("'active'"),
            nullable=False,
        ),
        sa.Column("created_at", TZ, server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", TZ),
        sa.CheckConstraint("level BETWEEN 1 AND 8", name="ck_ear_runs_level"),
    )
    op.create_index("ix_ear_runs_user_status", "ear_runs", ["user_id", "status"])


def downgrade() -> None:
    op.drop_table("ear_runs")
    op.drop_table("ear_progress")
