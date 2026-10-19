"""Songs and admin API against a real Postgres (TEST_DATABASE_URL). Telegram id 7 is the admin."""

import os
import time
from collections.abc import AsyncIterator

import httpx
import pytest
from sqlalchemy import update

from chordb_common.models import User

from app.deps import get_session
from app.init_data import sign_init_data
from app.main import app

TOKEN = os.environ["BOT_TOKEN"]
ADMIN, USER = 7, 42
AM, F, C, G = (
    {"root": 9, "quality": "min"},
    {"root": 5, "quality": "maj"},
    {"root": 0, "quality": "maj"},
    {"root": 7, "quality": "maj"},
)


@pytest.fixture
async def client(sessionmaker) -> AsyncIterator[httpx.AsyncClient]:
    async def _session():
        async with sessionmaker() as s:
            yield s

    app.dependency_overrides[get_session] = _session
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


def auth(user_id: int = USER) -> dict[str, str]:
    u = {"id": user_id, "first_name": "Bunyod", "language_code": "uz"}
    raw = sign_init_data({"user": u, "auth_date": str(int(time.time()))}, TOKEN)
    return {"Authorization": f"tma {raw}"}


def song_body(**over) -> dict:
    return {
        "title": "Yor-yor",
        "artist": "Xalq qoʻshigʻi",
        "youtube_id": "dQw4w9WgXcQ",
        "key": AM,
        "capo": 0,
        "difficulty": "easy",
        "language": "uz",
        "duration_sec": 195,
        **over,
    }


TIMELINE = {
    "sections": [{"title": "Kirish", "start_sec": 0}, {"title": "Kuplet", "start_sec": 10}],
    "events": [
        {"time_sec": 12.5, **G},  # out of order on purpose: the server sorts
        {"time_sec": 0, **AM},
        {"time_sec": 4.2, **F},
        {"time_sec": 10, **C},
        {"time_sec": 15, **AM},
    ],
}


async def published_song(client: httpx.AsyncClient, **over) -> dict:
    r = await client.post("/api/admin/songs", headers=auth(ADMIN), json=song_body(**over))
    assert r.status_code == 201, r.text
    song_id = r.json()["id"]
    r = await client.put(f"/api/admin/songs/{song_id}/events", headers=auth(ADMIN), json=TIMELINE)
    assert r.status_code == 200, r.text
    r = await client.patch(
        f"/api/admin/songs/{song_id}/publish", headers=auth(ADMIN), json={"is_published": True}
    )
    assert r.status_code == 200, r.text
    return r.json()


async def set_premium(sessionmaker, telegram_id: int) -> None:
    async with sessionmaker() as s:
        await s.execute(update(User).where(User.telegram_id == telegram_id).values(is_premium=True))
        await s.commit()


async def test_me_flags(client: httpx.AsyncClient) -> None:
    admin = (await client.get("/api/me", headers=auth(ADMIN))).json()
    user = (await client.get("/api/me", headers=auth(USER))).json()
    assert (admin["is_admin"], user["is_admin"]) == (True, False)
    assert user["is_premium"] is False


async def test_admin_only(client: httpx.AsyncClient) -> None:
    r = await client.post("/api/admin/songs", headers=auth(USER), json=song_body())
    assert r.status_code == 403
    assert (await client.get("/api/admin/songs", headers=auth(USER))).status_code == 403
    assert (await client.get("/api/admin/songs")).status_code == 401


async def test_create_timeline_publish(client: httpx.AsyncClient) -> None:
    r = await client.post("/api/admin/songs", headers=auth(ADMIN), json=song_body())
    assert r.status_code == 201
    song = r.json()
    assert song["is_published"] is False
    assert song["events"] == [] and song["sections"] == []
    sid = song["id"]

    # Drafts are invisible to users, visible to admins.
    assert (await client.get("/api/songs", headers=auth())).json()["songs"] == []
    assert (await client.get(f"/api/songs/{sid}", headers=auth())).status_code == 404
    assert (await client.get(f"/api/songs/{sid}", headers=auth(ADMIN))).status_code == 200

    # Can't publish an empty song.
    r = await client.patch(
        f"/api/admin/songs/{sid}/publish", headers=auth(ADMIN), json={"is_published": True}
    )
    assert r.status_code == 422

    r = await client.put(f"/api/admin/songs/{sid}/events", headers=auth(ADMIN), json=TIMELINE)
    assert r.status_code == 200
    detail = r.json()
    kirish, kuplet = (s["id"] for s in detail["sections"])
    assert [s["title"] for s in detail["sections"]] == ["Kirish", "Kuplet"]
    assert [(e["time_sec"], e["section_id"]) for e in detail["events"]] == [
        (0, kirish),
        (4.2, kirish),
        (10, kuplet),
        (12.5, kuplet),
        (15, kuplet),
    ]
    assert detail["chords_preview"] == [AM, F, C, G]

    r = await client.patch(
        f"/api/admin/songs/{sid}/publish", headers=auth(ADMIN), json={"is_published": True}
    )
    assert r.json()["is_published"] is True
    listed = (await client.get("/api/songs", headers=auth())).json()["songs"]
    assert [s["id"] for s in listed] == [sid]
    assert listed[0]["chords_preview"] == [AM, F, C, G]
    assert listed[0]["locked"] is False

    # PUT replaces the whole timeline.
    r = await client.put(
        f"/api/admin/songs/{sid}/events",
        headers=auth(ADMIN),
        json={"events": [{"time_sec": 1, **C}]},
    )
    assert r.json()["sections"] == []
    assert [(e["time_sec"], e["section_id"]) for e in r.json()["events"]] == [(1, None)]


async def test_update_song(client: httpx.AsyncClient) -> None:
    sid = (await published_song(client))["id"]
    r = await client.patch(
        f"/api/admin/songs/{sid}",
        headers=auth(ADMIN),
        json={"title": "Yangi nom", "key": {"root": 2, "quality": "maj"}, "capo": 3},
    )
    assert r.status_code == 200
    assert (r.json()["title"], r.json()["key"], r.json()["capo"]) == (
        "Yangi nom",
        {"root": 2, "quality": "maj"},
        3,
    )
    r = await client.patch(f"/api/admin/songs/{sid}", headers=auth(ADMIN), json={"title": None})
    assert r.status_code == 422


@pytest.mark.parametrize(
    "timeline, reason",
    [
        ({"events": [{"time_sec": 1, **C}, {"time_sec": 1, **G}]}, "same time"),
        (
            {"sections": [{"title": "Kuplet", "start_sec": 5}], "events": [{"time_sec": 1, **C}]},
            "before the first section",
        ),
        ({"events": [{"time_sec": 500, **C}]}, "beyond the end"),
        (
            {
                "sections": [{"title": "A", "start_sec": 0}, {"title": "B", "start_sec": 0}],
                "events": [],
            },
            "same time",
        ),
    ],
)
async def test_timeline_rejects(client: httpx.AsyncClient, timeline: dict, reason: str) -> None:
    sid = (await client.post("/api/admin/songs", headers=auth(ADMIN), json=song_body())).json()["id"]
    r = await client.put(f"/api/admin/songs/{sid}/events", headers=auth(ADMIN), json=timeline)
    assert r.status_code == 422
    assert reason in r.json()["detail"]


@pytest.mark.parametrize(
    "over",
    [
        {"youtube_id": "not-a-video-id"},
        {"key": {"root": 0, "quality": "7"}},  # keys are major or minor
        {"key": {"root": 12, "quality": "maj"}},
        {"capo": 13},
        {"difficulty": "expert"},
    ],
)
async def test_song_validation(client: httpx.AsyncClient, over: dict) -> None:
    r = await client.post("/api/admin/songs", headers=auth(ADMIN), json=song_body(**over))
    assert r.status_code == 422


async def test_filters_and_search(client: httpx.AsyncClient) -> None:
    a = await published_song(client, title="Bahor", artist="Sherali Joʻrayev")
    b = await published_song(
        client, title="Kino", artist="Viktor Tsoy", difficulty="medium", language="ru", capo=2
    )
    c = await published_song(client, title="100% sevgi", artist="Yulduz", difficulty="hard")

    async def ids(**params) -> set[int]:
        r = await client.get("/api/songs", headers=auth(), params=params)
        assert r.status_code == 200
        return {s["id"] for s in r.json()["songs"]}

    assert await ids() == {a["id"], b["id"], c["id"]}
    assert await ids(easy=True) == {a["id"]}
    assert await ids(uzbek=True) == {a["id"], c["id"]}
    assert await ids(no_capo=True) == {a["id"], c["id"]}
    assert await ids(uzbek=True, easy=True) == {a["id"]}
    assert await ids(q="tsoy") == {b["id"]}  # artist, case-insensitive
    assert await ids(q="BAH") == {a["id"]}  # title
    assert await ids(q="100%") == {c["id"]}  # % is literal, not a wildcard
    assert await ids(q="%") == {c["id"]}
    assert await ids(q="nothing like this") == set()


async def test_premium_paywall(client: httpx.AsyncClient, sessionmaker) -> None:
    song = await published_song(client, is_premium=True)
    sid = song["id"]

    listed = (await client.get("/api/songs", headers=auth())).json()["songs"]
    assert listed[0]["locked"] is True
    assert listed[0]["chords_preview"] == [AM, F, C, G]  # metadata stays visible

    r = await client.get(f"/api/songs/{sid}", headers=auth())
    assert r.status_code == 403
    d = r.json()["detail"]
    assert d["paywall"] is True and d["code"] == "premium_required"
    assert d["song"]["id"] == sid and "events" not in d["song"]
    r = await client.put(f"/api/songs/{sid}/progress", headers=auth(), json={"position_sec": 5})
    assert r.status_code == 403

    # Admins and premium users get the full song.
    assert (await client.get(f"/api/songs/{sid}", headers=auth(ADMIN))).status_code == 200
    await set_premium(sessionmaker, USER)
    r = await client.get(f"/api/songs/{sid}", headers=auth())
    assert r.status_code == 200
    assert len(r.json()["events"]) == 5
    assert r.json()["locked"] is False


async def test_continue_playing(client: httpx.AsyncClient) -> None:
    a = await published_song(client, title="A")
    b = await published_song(client, title="B")

    r = await client.get("/api/songs", headers=auth())
    assert r.json()["continue_playing"] is None

    assert (
        await client.put(f"/api/songs/{a['id']}/progress", headers=auth(), json={"position_sec": 30})
    ).status_code == 204
    await client.put(f"/api/songs/{b['id']}/progress", headers=auth(), json={"position_sec": 61.5})

    cont = (await client.get("/api/songs", headers=auth())).json()["continue_playing"]
    assert (cont["song"]["id"], cont["position_sec"]) == (b["id"], 61.5)
    assert cont["song"]["chords_preview"] == [AM, F, C, G]
    assert (await client.get(f"/api/songs/{b['id']}", headers=auth())).json()["position_sec"] == 61.5

    # Updating A makes it the most recent; finishing it falls back to B.
    await client.put(f"/api/songs/{a['id']}/progress", headers=auth(), json={"position_sec": 40})
    cont = (await client.get("/api/songs", headers=auth())).json()["continue_playing"]
    assert cont["song"]["id"] == a["id"]
    await client.put(f"/api/songs/{a['id']}/progress", headers=auth(), json={"position_sec": 9999})
    cont = (await client.get("/api/songs", headers=auth())).json()["continue_playing"]
    assert cont["song"]["id"] == b["id"]

    # Progress is per user.
    other = (await client.get("/api/songs", headers=auth(99))).json()["continue_playing"]
    assert other is None
