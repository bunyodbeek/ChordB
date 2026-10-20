"""analyses (automatic chord detection jobs and results)

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-20
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TZ = sa.DateTime(timezone=True)
QUALITIES = ("maj", "min", "7", "maj7", "m7", "dim", "aug", "sus2", "sus4")


def upgrade() -> None:
    op.create_table(
        "analyses",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "source",
            sa.Enum("upload", "youtube", name="analysis_source", native_enum=False, length=32),
            nullable=False,
        ),
        sa.Column("source_ref", sa.Text(), nullable=False),
        sa.Column("title", sa.String(255)),
        sa.Column("youtube_id", sa.String(32)),
        sa.Column("file_hash", sa.String(64)),
        sa.Column("media_path", sa.Text()),
        sa.Column(
            "status",
            sa.Enum(
                "queued", "running", "done", "failed",
                name="analysis_status", native_enum=False, length=32,
            ),
            server_default=sa.text("'queued'"),
            nullable=False,
        ),
        sa.Column("error_code", sa.String(32)),
        sa.Column("cache_hit", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("key_root", sa.SmallInteger()),
        sa.Column(
            "key_quality",
            sa.Enum(*QUALITIES, name="chord_quality", native_enum=False, length=32),
        ),
        sa.Column("bpm", sa.Float()),
        sa.Column("duration_sec", sa.Float()),
        sa.Column("beats", JSONB()),
        sa.Column("events", JSONB()),
        sa.Column("engine_version", sa.String(16)),
        sa.Column("created_at", TZ, server_default=sa.func.now(), nullable=False),
        sa.Column("started_at", TZ),
        sa.Column("finished_at", TZ),
        sa.CheckConstraint("key_root BETWEEN 0 AND 11", name="ck_analyses_key_root"),
    )
    op.create_index("ix_analyses_user_created", "analyses", ["user_id", "created_at"])
    op.create_index("ix_analyses_youtube_id", "analyses", ["youtube_id"])
    op.create_index("ix_analyses_file_hash", "analyses", ["file_hash"])
    op.create_index(
        "ix_analyses_queued", "analyses", ["id"], postgresql_where=sa.text("status = 'queued'")
    )


def downgrade() -> None:
    op.drop_index("ix_analyses_queued", table_name="analyses")
    op.drop_index("ix_analyses_file_hash", table_name="analyses")
    op.drop_index("ix_analyses_youtube_id", table_name="analyses")
    op.drop_index("ix_analyses_user_created", table_name="analyses")
    op.drop_table("analyses")
