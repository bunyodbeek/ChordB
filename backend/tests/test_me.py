"""API tests against a real Postgres (TEST_DATABASE_URL). Skipped if it is unreachable."""

import argparse
import asyncio
import os
import time
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.pool import NullPool

from chordb_common.db import make_engine, make_sessionmaker

from app.deps import get_session
from app.init_data import sign_init_data
from app.main import app

TOKEN = os.environ["BOT_TOKEN"]
BACKEND_DIR = Path(__file__).resolve().parents[1]


def _migrate(url: str) -> None:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.cmd_opts = argparse.Namespace(x=[f"url={url}"])
    command.upgrade(cfg, "head")


async def _reset_schema(engine) -> None:
    async with engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    url = os.environ["TEST_DATABASE_URL"]
    engine = make_engine(url, poolclass=NullPool)
    try:
        await _reset_schema(engine)
    except OSError:
        pytest.skip("TEST_DATABASE_URL not reachable")
    # Build the schema through the real migrations (env.py runs its own event loop).
    await asyncio.to_thread(_migrate, url)

    sessionmaker = make_sessionmaker(engine)

    async def _session():
        async with sessionmaker() as s:
            yield s

    app.dependency_overrides[get_session] = _session
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
    await engine.dispose()


def auth(user_id: int = 42, **user) -> dict[str, str]:
    u = {"id": user_id, "first_name": "Bunyod", "language_code": "uz", **user}
    raw = sign_init_data({"user": u, "auth_date": str(int(time.time()))}, TOKEN)
    return {"Authorization": f"tma {raw}"}


async def test_requires_auth(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/me")
    assert r.status_code == 401
    r = await client.get("/api/me", headers={"Authorization": "Bearer x"})
    assert r.status_code == 401
    r = await client.get("/api/me", headers={"Authorization": "tma user=1&hash=00"})
    assert r.status_code == 401


async def test_me_upserts(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/me", headers=auth(username="b1", is_premium=True))
    assert r.status_code == 200
    me = r.json()
    assert me["telegram_id"] == 42
    assert me["username"] == "b1"
    assert me["is_premium_tg"] is True
    assert me["settings"] == {"notation": None, "notifications_enabled": True}
    assert me["needs_write_access"] is True

    # Second request updates profile, same row.
    r = await client.get("/api/me", headers=auth(username="b2", first_name="Bek"))
    assert r.json()["id"] == me["id"]
    assert r.json()["username"] == "b2"
    assert r.json()["first_name"] == "Bek"


async def test_patch_settings(client: httpx.AsyncClient) -> None:
    r = await client.patch("/api/me/settings", headers=auth(), json={"notation": "solfege"})
    assert r.status_code == 200
    assert r.json()["settings"]["notation"] == "solfege"

    r = await client.patch(
        "/api/me/settings", headers=auth(), json={"notifications_enabled": False}
    )
    assert r.json()["settings"] == {"notation": "solfege", "notifications_enabled": False}

    r = await client.get("/api/me", headers=auth())
    assert r.json()["settings"] == {"notation": "solfege", "notifications_enabled": False}


@pytest.mark.parametrize(
    "body", [{"notation": "roman"}, {"notation": None}, {"is_blocked_bot": True}]
)
async def test_patch_settings_rejects(client: httpx.AsyncClient, body: dict) -> None:
    r = await client.patch("/api/me/settings", headers=auth(), json=body)
    assert r.status_code == 422


async def test_write_access_flow(client: httpx.AsyncClient) -> None:
    r = await client.post("/api/me/events", headers=auth(), json={"type": "write_access_requested"})
    assert r.status_code == 204
    assert (await client.get("/api/me", headers=auth())).json()["needs_write_access"] is False


async def test_allows_write_to_pm_from_init_data(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/me", headers=auth(allows_write_to_pm=True))
    assert r.json()["needs_write_access"] is False
