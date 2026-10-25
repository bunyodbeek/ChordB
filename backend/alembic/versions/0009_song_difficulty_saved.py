"""songs: automatic difficulty; saved songs per user

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Existing songs keep the difficulty the admin picked.
    op.add_column(
        "songs",
        sa.Column("difficulty_auto", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.create_table(
        "user_saved_songs",
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
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("user_saved_songs")
    op.drop_column("songs", "difficulty_auto")
