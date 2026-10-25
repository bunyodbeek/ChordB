"""Payments, premium periods, admin users and dashboard stats (real Postgres). Admin = id 7."""

import json
import time
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import select, update

from chordb_common.config import get_settings
from chordb_common.models import Analysis, AnalysisSource, AnalysisStatus, SearchMiss, User

from app import alerts
from app.init_data import sign_init_data
from tests.test_songs import ADMIN, TOKEN, USER, auth, client, published_song  # noqa: F401

PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 64


@pytest.fixture
def telegram(monkeypatch) -> list[dict]:
    """Every Bot API sendMessage the backend makes, instead of sending it."""
    sent: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={"ok": True})

    real = httpx.AsyncClient
    monkeypatch.setattr(
        alerts.httpx, "AsyncClient",
        lambda **kw: real(transport=httpx.MockTransport(handler), **kw),
    )
    return sent


async def user_id(sessionmaker, telegram_id: int) -> int:
    async with sessionmaker() as s:
        return await s.scalar(select(User.id).where(User.telegram_id == telegram_id))


async def pay(client, plan="month", who=USER, data=PNG, content_type="image/png"):
    return await client.post(
        "/api/payments",
        headers=auth(who),
        data={"plan": plan},
        files={"receipt": ("chek.png", data, content_type)},
    )


async def test_payment_info_lists_plans_and_card(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "payment_card", "8600 0000 0000 0001")
    r = await client.get("/api/payments", headers=auth())
    assert r.status_code == 200
    body = r.json()
    assert body["card"] == "8600 0000 0000 0001"
    assert [(p["id"], p["days"]) for p in body["plans"]] == [("month", 30), ("quarter", 90)]
    assert body["latest"] is None
    assert body["premium_songs"] == 0


async def test_payment_flow_approve(client, sessionmaker, telegram):
    r = await pay(client)
    assert r.status_code == 201, r.text
    payment = r.json()
    assert payment["status"] == "pending" and payment["amount"] == 20_000
    assert any("Yangi toʻlov" in m["text"] for m in telegram)  # admins were told

    # One at a time.
    assert (await pay(client)).status_code == 409

    r = await client.get("/api/admin/payments", headers=auth(ADMIN))
    assert [p["id"] for p in r.json()] == [payment["id"]]
    r = await client.get(f"/api/admin/payments/{payment['id']}/receipt", headers=auth(ADMIN))
    assert r.content == PNG and r.headers["content-type"] == "image/png"

    r = await client.post(
        f"/api/admin/payments/{payment['id']}/approve", headers=auth(ADMIN), json={"note": "Click"}
    )
    assert r.status_code == 200, r.text
    detail = r.json()
    assert detail["user"]["has_premium"] and detail["pending"] is None
    until = datetime.fromisoformat(detail["user"]["premium_until"])
    assert timedelta(days=29) < until - datetime.now(UTC) <= timedelta(days=30)
    assert detail["history"][0]["kind"] == "paid"
    assert "tasdiqlandi" in telegram[-1]["text"]

    me = (await client.get("/api/me", headers=auth())).json()
    assert me["is_premium"] and me["premium_until"]

    # Decided once only.
    r = await client.post(f"/api/admin/payments/{payment['id']}/reject", headers=auth(ADMIN), json={})
    assert r.status_code == 409


async def test_approving_again_extends_the_period(client, sessionmaker, telegram):
    for _ in range(2):
        pid = (await pay(client)).json()["id"]
        await client.post(f"/api/admin/payments/{pid}/approve", headers=auth(ADMIN), json={})
    me = (await client.get("/api/me", headers=auth())).json()
    left = datetime.fromisoformat(me["premium_until"]) - datetime.now(UTC)
    assert timedelta(days=59) < left <= timedelta(days=60)


async def test_reject_tells_the_user_why(client, telegram):
    pid = (await pay(client)).json()["id"]
    r = await client.post(
        f"/api/admin/payments/{pid}/reject", headers=auth(ADMIN), json={"note": "Chek xira"}
    )
    assert r.status_code == 200
    assert not r.json()["user"]["has_premium"]
    assert "Chek xira" in telegram[-1]["text"]
    latest = (await client.get("/api/payments", headers=auth())).json()["latest"]
    assert latest["status"] == "rejected" and latest["note"] == "Chek xira"
    assert (await pay(client)).status_code == 201  # may try again


@pytest.mark.parametrize(
    ("plan", "size", "content_type", "code"),
    [
        ("week", 10, "image/png", 422),
        ("month", 10, "application/pdf", 415),
        ("month", 0, "image/png", 422),
        ("month", 5 * 1024 * 1024 + 1, "image/png", 413),
    ],
)
async def test_bad_receipts(client, telegram, plan, size, content_type, code):
    r = await pay(client, plan, data=b"x" * size, content_type=content_type)
    assert r.status_code == code


async def test_payments_admin_only(client):
    assert (await client.get("/api/admin/payments", headers=auth())).status_code == 403
    assert (await client.get("/api/admin/users", headers=auth())).status_code == 403
    assert (await client.get("/api/admin/stats", headers=auth())).status_code == 403


async def test_grant_and_revoke(client, sessionmaker, telegram):
    await client.get("/api/me", headers=auth())
    uid = await user_id(sessionmaker, USER)

    r = await client.post(f"/api/admin/users/{uid}/premium", headers=auth(ADMIN), json={"days": 7})
    assert r.status_code == 200 and r.json()["user"]["has_premium"]
    assert "Premium berildi" in telegram[-1]["text"]

    r = await client.post(f"/api/admin/users/{uid}/premium", headers=auth(ADMIN), json={"days": None})
    assert r.json()["user"]["premium_forever"]

    r = await client.post(f"/api/admin/users/{uid}/premium/revoke", headers=auth(ADMIN), json={})
    user = r.json()["user"]
    assert not user["has_premium"] and not user["premium_forever"]
    assert [h["kind"] for h in r.json()["history"]][:3] == ["revoked", "granted", "granted"]
    assert r.json()["history"][0]["admin_name"] == "Bunyod"


async def test_expired_premium_locks_again(client, sessionmaker):
    await client.get("/api/me", headers=auth())
    async with sessionmaker() as s:
        await s.execute(
            update(User)
            .where(User.telegram_id == USER)
            .values(premium_until=datetime.now(UTC) - timedelta(minutes=1))
        )
        await s.commit()
    assert (await client.get("/api/me", headers=auth())).json()["is_premium"] is False
    uid = await user_id(sessionmaker, USER)
    history = (await client.get(f"/api/admin/users/{uid}", headers=auth(ADMIN))).json()["history"]
    assert history[0]["kind"] == "expired"


async def test_users_filters_and_search(client, sessionmaker, telegram):
    for tid in (USER, 43, 44):
        await client.get("/api/me", headers=auth(tid))
    async with sessionmaker() as s:
        await s.execute(update(User).where(User.telegram_id == 43).values(is_blocked_bot=True,
                                                                           username="otabek"))
        await s.commit()
    await pay(client, who=44)

    r = await client.get("/api/admin/users", headers=auth(ADMIN))
    body = r.json()
    assert body["counts"] == {"all": 4, "premium": 0, "active_free": 4, "pending": 1, "blocked": 1}
    assert body["items"][0]["telegram_id"] == 44  # pending payment first

    r = await client.get("/api/admin/users?filter=blocked", headers=auth(ADMIN))
    assert [u["telegram_id"] for u in r.json()["items"]] == [43]
    r = await client.get("/api/admin/users?q=@otab", headers=auth(ADMIN))
    assert [u["telegram_id"] for u in r.json()["items"]] == [43]
    r = await client.get("/api/admin/users?q=44", headers=auth(ADMIN))
    assert [u["telegram_id"] for u in r.json()["items"]] == [44]


async def test_stats(client, sessionmaker, telegram):
    song = await published_song(client)
    await client.get("/api/me", headers=auth())
    await client.post("/api/me/events", headers=auth(), json={"type": "tuner_opened"})
    await client.get(f"/api/songs/{song['id']}", headers=auth())
    await client.post("/api/me/events", headers=auth(), json={"type": "premium_viewed"})
    pid = (await pay(client)).json()["id"]
    await client.post(f"/api/admin/payments/{pid}/approve", headers=auth(ADMIN), json={})

    r = await client.get("/api/admin/stats?period=7d", headers=auth(ADMIN))
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["users_total"] == 2 and s["users_new"] == 2 and s["premium"] == 1
    assert s["revenue_month"] == 20_000
    assert len(s["new_by_day"]) == 14 and s["new_by_day"][-1]["count"] == 2
    funnel = {f["step"]: f["users"] for f in s["funnel"]}
    assert funnel == {
        # The admin only used admin endpoints, never /api/me.
        "opened": 1, "tuner": 1, "song": 1, "premium_viewed": 1, "payment_sent": 1, "approved": 1
    }
    assert s["pending_count"] == 0


async def test_catalog_requests(client, sessionmaker):
    song = await published_song(client)
    await client.get("/api/me", headers=auth())
    uid = await user_id(sessionmaker, USER)
    now = datetime.now(UTC)
    async with sessionmaker() as s:
        s.add_all([
            # Typed letter by letter: only the last one counts.
            SearchMiss(user_id=uid, query="sho", created_at=now - timedelta(seconds=30)),
            SearchMiss(user_id=uid, query="shoxrux", created_at=now - timedelta(seconds=29)),
        ])
        for vid, title in (("aaaaaaaaaaa", "Yangi qoʻshiq"), ("dQw4w9WgXcQ", "In the catalog")):
            s.add(Analysis(
                user_id=uid, source=AnalysisSource.YOUTUBE, source_ref="x", youtube_id=vid,
                title=title, status=AnalysisStatus.DONE,
            ))
        await s.commit()
    assert song["title"]  # published_song() uses youtube_id dQw4w9WgXcQ

    requests = (await client.get("/api/admin/stats", headers=auth(ADMIN))).json()["requests"]
    assert sorted((r["title"], r["searches"], r["analyses"]) for r in requests) == [
        ("Yangi qoʻshiq", 0, 1), ("shoxrux", 1, 0)
    ]


async def test_search_miss_is_logged(client, sessionmaker):
    await client.get("/api/songs?q=Shahzoda", headers=auth())
    await client.get("/api/songs?q=ab", headers=auth())  # too short
    await client.get("/api/songs?q=Zzz&easy=true", headers=auth())  # filtered: not a miss
    async with sessionmaker() as s:
        assert (await s.scalars(select(SearchMiss.query))).all() == ["shahzoda"]


async def test_deep_link_opens_song_and_counts(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "bot_username", "ChordBbot")
    monkeypatch.setattr(get_settings(), "webapp_short_name", "app")
    song = await published_song(client)
    u = {"id": USER, "first_name": "Bunyod"}
    raw = sign_init_data(
        {"user": u, "auth_date": str(int(time.time())), "start_param": f"song_{song['id']}"}, TOKEN
    )
    me = (await client.get("/api/me", headers={"Authorization": f"tma {raw}"})).json()
    assert me["start_song_id"] == song["id"]

    r = await client.get(f"/api/admin/songs/{song['id']}/link", headers=auth(ADMIN))
    assert r.json() == {
        "url": f"https://t.me/ChordBbot/app?startapp=song_{song['id']}", "opened": 1, "paid": 0
    }
