"""Shared pytest setup for all workspace packages. Run `uv run pytest` from the repo root."""

import argparse
import asyncio
import os
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent


def _test_database_url_from_env_file() -> str | None:
    """TEST_DATABASE_URL out of .env, which pytest itself does not read.

    The app loads .env through pydantic-settings, but that happens too late here: the
    URL is needed before any module reads settings. Without this, a Postgres on a port
    other than 5432 (common when other projects already use it) is silently ignored.
    """
    env_file = ROOT / ".env"
    if not env_file.exists():
        return None
    for line in env_file.read_text(encoding="utf-8-sig").splitlines():
        key, _, value = line.partition("=")
        if key.strip() == "TEST_DATABASE_URL":
            return value.strip().strip("\"'") or None
    return None


# Must be set before any module reads settings.
os.environ["BOT_TOKEN"] = "123456:TEST-token"
os.environ["ENV"] = "dev"
os.environ["WEBAPP_URL"] = "https://chordb.test"
os.environ["ADMIN_IDS"] = "7"  # telegram id 7 is the admin in API tests
# An explicit TEST_DATABASE_URL in the environment wins, then .env, then the default.
DEFAULT_TEST_DATABASE_URL = "postgresql+asyncpg://chordb:chordb@127.0.0.1:5432/chordb_test"
os.environ.setdefault(
    "TEST_DATABASE_URL", _test_database_url_from_env_file() or DEFAULT_TEST_DATABASE_URL
)
os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402

from chordb_common.db import make_engine, make_sessionmaker  # noqa: E402

BACKEND_DIR = ROOT / "backend"


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
