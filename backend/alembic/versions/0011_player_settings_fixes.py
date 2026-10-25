"""player: per-song capo/key settings, chord fixes on own analyses, catalog chord suggestions

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TZ = sa.DateTime(timezone=True)
QUALITIES = ("maj", "min", "7", "maj7", "m7", "dim", "aug", "sus2", "sus4")


def _quality(name: str = "quality") -> sa.Column:
    return sa.Column(
        name, sa.Enum(*QUALITIES, name="chord_quality", native_enum=False, length=32), nullable=False
    )


def _user_fk(**kw) -> sa.Column:
    return sa.Column(
        "user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, **kw
    )


def upgrade() -> None:
    op.create_table(
        "user_song_settings",
        _user_fk(primary_key=True),
        sa.Column(
            "kind",
            sa.Enum("song", "analysis", name="song_kind", native_enum=False, length=32),
            primary_key=True,
        ),
        sa.Column("ref_id", sa.BigInteger(), primary_key=True),
        sa.Column("capo", sa.SmallInteger(), nullable=False),
        sa.Column("shift", sa.SmallInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("simple", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("updated_at", TZ, server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("capo BETWEEN 0 AND 12", name="ck_user_song_settings_capo"),
        sa.CheckConstraint("shift BETWEEN -11 AND 11", name="ck_user_song_settings_shift"),
    )

    op.create_table(
        "song_event_overrides",
        sa.Column(
            "analysis_id",
            sa.BigInteger(),
            sa.ForeignKey("analyses.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("event_index", sa.Integer(), primary_key=True),
        sa.Column("root", sa.SmallInteger(), nullable=False),
        _quality(),
        sa.Column("created_at", TZ, server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("root BETWEEN 0 AND 11", name="ck_song_event_overrides_root"),
    )

    op.create_table(
        "chord_suggestions",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "song_id", sa.BigInteger(), sa.ForeignKey("songs.id", ondelete="CASCADE"), nullable=False
        ),
        _user_fk(),
        sa.Column("event_ids", JSONB(), nullable=False),
        sa.Column("old_root", sa.SmallInteger(), nullable=False),
        _quality("old_quality"),
        sa.Column("root", sa.SmallInteger(), nullable=False),
        _quality(),
        sa.Column(
            "status",
            sa.Enum("pending", "accepted", "rejected", name="suggestion_status", native_enum=False, length=32),
            server_default=sa.text("'pending'"),
            nullable=False,
        ),
        sa.Column("decided_by", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("decided_at", TZ),
        sa.Column("created_at", TZ, server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("root BETWEEN 0 AND 11", name="ck_chord_suggestions_root"),
        sa.CheckConstraint("old_root BETWEEN 0 AND 11", name="ck_chord_suggestions_old_root"),
    )
    op.create_index("ix_chord_suggestions_user_created", "chord_suggestions", ["user_id", "created_at"])
    op.create_index("ix_chord_suggestions_status", "chord_suggestions", ["status", "created_at"])


def downgrade() -> None:
    op.drop_table("chord_suggestions")
    op.drop_table("song_event_overrides")
    op.drop_table("user_song_settings")
