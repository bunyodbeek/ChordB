"""Shared pytest setup for all workspace packages. Run `uv run pytest` from the repo root."""

import argparse
import asyncio
import os
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

# Must be set before any module reads settings.
os.environ["BOT_TOKEN"] = "123456:TEST-token"
os.environ["ENV"] = "dev"
os.environ["WEBAPP_URL"] = "https://chordb.test"
os.environ.setdefault(
    "TEST_DATABASE_URL", "postgresql+asyncpg://chordb:chordb@127.0.0.1:5432/chordb_test"
)
os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402

from chordb_common.db import make_engine, make_sessionmaker  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parent / "backend"


def _migrate(url: str) -> None:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.cmd_opts = argparse.Namespace(x=[f"url={url}"])
    command.upgrade(cfg, "head")


@pytest.fixture
async def sessionmaker() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """A fresh database built through the real migrations. Wipes TEST_DATABASE_URL."""
    url = os.environ["TEST_DATABASE_URL"]
    engine = make_engine(url, poolclass=NullPool)
    try:
        async with engine.begin() as conn:
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
    except OSError:
        pytest.skip("TEST_DATABASE_URL not reachable")
    # env.py runs its own event loop, so migrate from a worker thread.
    await asyncio.to_thread(_migrate, url)
    yield make_sessionmaker(engine)
    await engine.dispose()
