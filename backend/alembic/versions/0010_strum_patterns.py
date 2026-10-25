"""strumming: patterns (seeded), a song's pattern, tempo and metre, trainer progress

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# A copy of chordb_common.strum.SEED as it was: migrations don't import app code.
SEED = (
    (1, "Asosiy", "D-D-D-D-", False, 1),
    (2, "Pop", "D-DU-UDU", False, 2),
    (3, "Balada", "D-D-DUDU", True, 3),
    (4, "Reggi", "-U-U-U-U", True, 4),
)


def _pattern_fk() -> sa.Column:
    return sa.Column(
        "strum_pattern_id", sa.Integer(), sa.ForeignKey("strum_patterns.id", ondelete="SET NULL")
    )


def upgrade() -> None:
    patterns = op.create_table(
        "strum_patterns",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(32), nullable=False),
        sa.Column("slots", sa.String(8), nullable=False),
        sa.Column("is_premium", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("sort", sa.SmallInteger(), server_default=sa.text("0"), nullable=False),
        sa.CheckConstraint("slots ~ '^[DUx-]{8}$'", name="ck_strum_patterns_slots"),
    )
    op.bulk_insert(
        patterns,
        [
            {"id": i, "name": name, "slots": slots, "is_premium": premium, "sort": sort}
            for i, name, slots, premium, sort in SEED
        ],
    )
    # The ids above were given by hand: move the sequence past them.
    op.execute("SELECT setval(pg_get_serial_sequence('strum_patterns', 'id'), max(id)) FROM strum_patterns")

    op.add_column("songs", _pattern_fk())
    op.add_column("songs", sa.Column("bpm", sa.Float()))
    op.add_column(
        "songs",
        sa.Column("time_signature", sa.String(5), server_default=sa.text("'4/4'"), nullable=False),
    )
    op.create_check_constraint("ck_songs_bpm", "songs", "bpm BETWEEN 30 AND 300")
    op.create_check_constraint(
        "ck_songs_time_signature", "songs", "time_signature IN ('2/4', '3/4', '4/4', '6/8')"
    )
    op.add_column("chord_events", _pattern_fk())

    op.create_table(
        "strum_progress",
        sa.Column(
            "user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "pattern_id",
            sa.Integer(),
            sa.ForeignKey("strum_patterns.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("bpm", sa.SmallInteger(), primary_key=True),
        sa.Column("best_accuracy", sa.Float(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("best_accuracy BETWEEN 0 AND 1", name="ck_strum_progress_accuracy"),
    )


def downgrade() -> None:
    op.drop_table("strum_progress")
    op.drop_column("chord_events", "strum_pattern_id")
    op.drop_constraint("ck_songs_time_signature", "songs", type_="check")
    op.drop_constraint("ck_songs_bpm", "songs", type_="check")
    op.drop_column("songs", "time_signature")
    op.drop_column("songs", "bpm")
    op.drop_column("songs", "strum_pattern_id")
    op.drop_table("strum_patterns")
