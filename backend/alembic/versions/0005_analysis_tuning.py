"""analyses: tuning offset, alternative tuning, suggested capo (engine 1.1)

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-20
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("analyses", sa.Column("tuning_offset_cents", sa.Float()))
    op.add_column("analyses", sa.Column("alt_tuning", JSONB()))
    op.add_column("analyses", sa.Column("suggested_capo", sa.SmallInteger()))


def downgrade() -> None:
    op.drop_column("analyses", "suggested_capo")
    op.drop_column("analyses", "alt_tuning")
    op.drop_column("analyses", "tuning_offset_cents")
