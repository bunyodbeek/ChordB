"""songs, sections, chord events, progress; users.is_premium

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-19
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TZ = sa.DateTime(timezone=True)
QUALITIES = ("maj", "min", "7", "maj7", "m7", "dim", "aug", "sus2", "sus4")


def _quality() -> sa.Enum:
    return sa.Enum(*QUALITIES, name="chord_quality", native_enum=False, length=32)


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_premium", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )

    op.create_table(
        "songs",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("artist", sa.String(255), nullable=False),
        sa.Column("youtube_id", sa.String(32), nullable=False),
        sa.Column("key_root", sa.SmallInteger(), nullable=False),
        sa.Column("key_quality", _quality(), nullable=False),
        sa.Column("capo", sa.SmallInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "difficulty",
            sa.Enum("easy", "medium", "hard", name="difficulty", native_enum=False, length=32),
            nullable=False,
        ),
        sa.Column("language", sa.String(8), server_default=sa.text("'uz'"), nullable=False),
        sa.Column("is_premium", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("is_published", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("duration_sec", sa.Integer(), nullable=False),
        sa.Column("created_at", TZ, server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("key_root BETWEEN 0 AND 11", name="ck_songs_key_root"),
        sa.CheckConstraint("capo BETWEEN 0 AND 12", name="ck_songs_capo"),
        sa.CheckConstraint("duration_sec > 0", name="ck_songs_duration"),
    )

    op.create_table(
        "song_sections",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "song_id",
            sa.BigInteger(),
            sa.ForeignKey("songs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("order", sa.SmallInteger(), nullable=False),
        sa.Column("title", sa.String(64), nullable=False),
        sa.Column("start_sec", sa.Float(), nullable=False),
        sa.UniqueConstraint("song_id", "order", name="uq_song_sections_order"),
    )

    op.create_table(
        "chord_events",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "song_id",
            sa.BigInteger(),
            sa.ForeignKey("songs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "section_id",
            sa.BigInteger(),
            sa.ForeignKey("song_sections.id", ondelete="CASCADE"),
        ),
        sa.Column("time_sec", sa.Float(), nullable=False),
        sa.Column("root", sa.SmallInteger(), nullable=False),
        sa.Column("quality", _quality(), nullable=False),
        sa.CheckConstraint("root BETWEEN 0 AND 11", name="ck_chord_events_root"),
    )
    op.create_index("ix_chord_events_song_time", "chord_events", ["song_id", "time_sec"])

    op.create_table(
        "user_song_progress",
        sa.Column(
            "user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "song_id",
            sa.BigInteger(),
            sa.ForeignKey("songs.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("position_sec", sa.Float(), nullable=False),
        sa.Column("updated_at", TZ, server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_user_song_progress_recent", "user_song_progress", ["user_id", "updated_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_user_song_progress_recent", table_name="user_song_progress")
    op.drop_table("user_song_progress")
    op.drop_index("ix_chord_events_song_time", table_name="chord_events")
    op.drop_table("chord_events")
    op.drop_table("song_sections")
    op.drop_table("songs")
    op.drop_column("users", "is_premium")
