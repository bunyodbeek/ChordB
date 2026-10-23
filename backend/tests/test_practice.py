"""Practice API against a real Postgres: daily steps, streak, game results, collection."""

import time
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select, update

from chordb_common.models import PracticeDay, Streak, User, UserEvent, UserEventType
from chordb_common.practice import local_date

from app.init_data import sign_init_data
from tests.test_songs import TOKEN, USER, auth, client  # noqa: F401

AM, C, G, F = (
    {"root": 9, "quality": "min"},
    {"root": 0, "quality": "maj"},
    {"root": 7, "quality": "maj"},
    {"root": 5, "quality": "maj"},
)
EM = {"root": 4, "quality": "min"}


def switch_result(switches=24, chains=6, duration=60.0, chain=(AM, C, G, F), score=None):
    return {
        "game": "chord_switch",
        "score": switches if score is None else score,
        "details": {"chain": list(chain), "switches": switches, "chains": chains, "duration_sec": duration},
    }


async def user_row(sessionmaker, telegram_id=USER) -> User:
    async with sessionmaker() as s:
        return await s.scalar(select(User).where(User.telegram_id == telegram_id))


async def test_today_starts_empty(client):
    r = await client.get("/api/practice/today", headers=auth())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["steps"] == ["tune", "chord_switch", "ear_test"]
    assert body["steps_done"] == [] and body["completed"] is False
    assert body["chain"] == [AM, C, G, F]
    assert body["streak"] == {"current": 0, "best": 0, "freezes_left": 1, "last_practice_date": None}


async def test_three_steps_complete_the_day_once(client, sessionmaker):
    for step in ("tune", "chord_switch", "tune"):  # repeating a step changes nothing
        r = await client.post("/api/practice/step", headers=auth(), json={"step": step})
        assert r.status_code == 200
    assert r.json()["steps_done"] == ["tune", "chord_switch"]
    assert r.json()["completed"] is False

    r = await client.post("/api/practice/step", headers=auth(), json={"step": "ear_test"})
    body = r.json()
    assert body["completed"] is True
    assert body["streak"]["current"] == 1 and body["streak"]["best"] == 1

    # More steps the same day don't count the day twice.
    r = await client.post("/api/practice/step", headers=auth(), json={"step": "tune"})
    assert r.json()["streak"]["current"] == 1

    async with sessionmaker() as s:
        steps = (await s.scalars(
            select(UserEvent.ref).where(UserEvent.type == UserEventType.PRACTICE_STEP)
        )).all()
    assert sorted(steps) == ["chord_switch", "ear_test", "tune"]


async def test_streak_continues_from_yesterday(client, sessionmaker):
    await client.get("/api/me", headers=auth())
    u = await user_row(sessionmaker)
    today = local_date(datetime.now(UTC), None)
    async with sessionmaker() as s:
        s.add(Streak(user_id=u.id, current=4, best=6, last_practice_date=today - timedelta(days=1),
                     freezes_left=1, freezes_month=today.replace(day=1)))
        await s.commit()
    for step in ("tune", "chord_switch", "ear_test"):
        r = await client.post("/api/practice/step", headers=auth(), json={"step": step})
    assert r.json()["streak"] == {
        "current": 5, "best": 6, "freezes_left": 1, "last_practice_date": today.isoformat()
    }


async def test_missed_day_uses_the_freeze(client, sessionmaker):
    await client.get("/api/me", headers=auth())
    u = await user_row(sessionmaker)
    today = local_date(datetime.now(UTC), None)
    async with sessionmaker() as s:
        s.add(Streak(user_id=u.id, current=3, best=3, last_practice_date=today - timedelta(days=2),
                     freezes_left=1, freezes_month=today.replace(day=1)))
        await s.commit()
    # Shown as still alive before practising today.
    assert (await client.get("/api/practice/today", headers=auth())).json()["streak"]["current"] == 3
    for step in ("tune", "chord_switch", "ear_test"):
        r = await client.post("/api/practice/step", headers=auth(), json={"step": step})
    assert r.json()["streak"]["current"] == 4
    assert r.json()["streak"]["freezes_left"] == 0


async def test_timezone_decides_the_day(client, sessionmaker):
    r = await client.patch("/api/me/settings", headers=auth(), json={"timezone": "Pacific/Kiritimati"})
    assert r.status_code == 200 and r.json()["settings"]["timezone"] == "Pacific/Kiritimati"
    r = await client.get("/api/practice/today", headers=auth())
    assert r.json()["date"] == local_date(datetime.now(UTC), "Pacific/Kiritimati").isoformat()
    bad = await client.patch("/api/me/settings", headers=auth(), json={"timezone": "Mars/Base"})
    assert bad.status_code == 422


async def test_chord_switch_result_and_personal_best(client):
    r = await client.post("/api/games/result", headers=auth(), json=switch_result(switches=13, chains=3))
    assert r.status_code == 201, r.text
    assert (r.json()["best"], r.json()["new_best"]) == (13, True)
    assert r.json()["today"]["steps_done"] == ["chord_switch"]  # the game is the step

    r = await client.post("/api/games/result", headers=auth(), json=switch_result(switches=9, chains=2))
    assert (r.json()["best"], r.json()["new_best"]) == (13, False)

    r = await client.post("/api/games/result", headers=auth(), json=switch_result(switches=18, chains=4))
    assert (r.json()["best"], r.json()["new_best"]) == (18, True)

    summary = (await client.get("/api/practice/summary", headers=auth())).json()
    assert summary["bests"] == [{"game": "chord_switch", "chain_key": "Am-C-G-F", "value": 18}]


@pytest.mark.parametrize(
    "body",
    [
        switch_result(switches=61, chains=15),  # > 60 switches a minute
        switch_result(switches=40, chains=5, duration=30),  # 80 a minute
        switch_result(switches=12, chains=3, score=20),  # score ≠ switches
        switch_result(switches=8, chains=5),  # more chains than switches allow
        switch_result(chain=(AM,)),  # a chain needs two chords
        switch_result(duration=600),
        # Ear test scores come only from server-checked runs (/api/ear/runs).
        {"game": "ear_test", "score": 10, "details": {"level": 1, "answers": []}},
        {"game": "rhythm", "score": 1, "details": {}},
    ],
)
async def test_impossible_results_are_rejected(client, body):
    r = await client.post("/api/games/result", headers=auth(), json=body)
    assert r.status_code == 422, r.text


async def test_games_complete_the_day(client, sessionmaker):
    from tests.test_ear import play_run

    await client.post("/api/practice/step", headers=auth(), json={"step": "tune"})
    await client.post("/api/games/result", headers=auth(), json=switch_result())
    await play_run(client, sessionmaker, level=1, wrong=2)
    today = (await client.get("/api/practice/today", headers=auth())).json()
    assert today["completed"] is True
    assert today["streak"]["current"] == 1


async def test_collection_unlock_is_idempotent(client, sessionmaker):
    for _ in range(2):
        r = await client.post("/api/collection/unlock", headers=auth(), json={**EM, "mode": "played"})
        assert r.status_code == 200
    assert [(c["root"], c["quality"], c["mode"]) for c in r.json()] == [(4, "min", "played")]
    summary = (await client.get("/api/practice/summary", headers=auth())).json()
    assert len(summary["collectible"]) == 24 and summary["collectible"][0] == AM
    assert len(summary["collection"]) == 1
    async with sessionmaker() as s:
        unlocks = (await s.scalars(
            select(UserEvent.ref).where(UserEvent.type == UserEventType.CHORD_UNLOCK)
        )).all()
    assert unlocks == ["Em"]


async def test_game_start_event(client, sessionmaker):
    r = await client.post("/api/me/events", headers=auth(), json={"type": "game_start", "ref": "ear_test"})
    assert r.status_code == 204
    bad = await client.post("/api/me/events", headers=auth(), json={"type": "game_start", "ref": "x"})
    assert bad.status_code == 422


async def test_practice_deep_link(client):
    u = {"id": USER, "first_name": "Bunyod"}
    raw = sign_init_data({"user": u, "auth_date": str(int(time.time())), "start_param": "practice"}, TOKEN)
    me = (await client.get("/api/me", headers={"Authorization": f"tma {raw}"})).json()
    assert me["start_tab"] == "practice"
    assert (await client.get("/api/me", headers=auth())).json()["start_tab"] is None


async def test_concurrent_last_steps_count_the_day_once(client, sessionmaker):
    import asyncio

    await client.post("/api/practice/step", headers=auth(), json={"step": "tune"})
    await client.post("/api/practice/step", headers=auth(), json={"step": "chord_switch"})
    rs = await asyncio.gather(*(
        client.post("/api/practice/step", headers=auth(), json={"step": "ear_test"}) for _ in range(3)
    ))
    assert all(r.status_code == 200 for r in rs)
    u = await user_row(sessionmaker)
    async with sessionmaker() as s:
        streak = await s.get(Streak, u.id)
        days = (await s.scalars(select(PracticeDay).where(PracticeDay.user_id == u.id))).all()
    assert streak.current == 1 and len(days) == 1 and days[0].completed


async def test_old_practice_day_does_not_break_today(client, sessionmaker):
    await client.get("/api/me", headers=auth())
    u = await user_row(sessionmaker)
    async with sessionmaker() as s:
        s.add(PracticeDay(user_id=u.id, date=date(2020, 1, 1), steps_done=["tune"], completed=False))
        await s.execute(update(User).where(User.id == u.id).values(timezone="Asia/Tashkent"))
        await s.commit()
    r = await client.get("/api/practice/today", headers=auth())
    assert r.json()["steps_done"] == []
