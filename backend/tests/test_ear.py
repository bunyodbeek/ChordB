"""Ear-test levels against a real Postgres: runs, answers, strict 10/10 unlocking."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update

from chordb_common.models import EarProgress, EarRun, User

from tests.test_songs import USER, auth, client  # noqa: F401


async def _user_id(sessionmaker, telegram_id=USER) -> int:
    async with sessionmaker() as s:
        return await s.scalar(select(User.id).where(User.telegram_id == telegram_id))


async def _answers(sessionmaker, run_id: str) -> list[str]:
    """The right options, which only the database knows."""
    async with sessionmaker() as s:
        run = await s.get(EarRun, uuid.UUID(run_id))
        return [q["answer"] for q in run.questions]


async def set_progress(client, sessionmaker, max_level: int, premium: bool = False) -> None:
    await client.get("/api/ear/progress", headers=auth())  # creates the user and the row
    uid = await _user_id(sessionmaker)
    async with sessionmaker() as s:
        await s.execute(update(EarProgress).where(EarProgress.user_id == uid).values(max_unlocked_level=max_level))
        await s.execute(update(User).where(User.id == uid).values(is_premium=premium))
        await s.commit()


async def play_run(client, sessionmaker, level: int = 1, wrong: int = 0) -> dict:
    """Start a run, answer all ten (the first `wrong` of them wrongly), finish it."""
    r = await client.post("/api/ear/runs", headers=auth(), json={"level": level})
    assert r.status_code == 201, r.text
    run = r.json()
    right = await _answers(sessionmaker, run["run_id"])
    for q, ans in zip(run["questions"], right, strict=True):
        choice = next(o["id"] for o in q["options"] if o["id"] != ans) if q["question_id"] < wrong else ans
        a = await client.post(f"/api/ear/runs/{run['run_id']}/answer", headers=auth(),
                              json={"question_id": q["question_id"], "choice": choice})
        assert a.status_code == 200, a.text
        assert a.json()["correct"] is (q["question_id"] >= wrong)
        assert a.json()["correct_answer"] == ans
    f = await client.post(f"/api/ear/runs/{run['run_id']}/finish", headers=auth())
    assert f.status_code == 200, f.text
    return f.json()


async def test_progress_starts_at_level_one(client):
    r = await client.get("/api/ear/progress", headers=auth())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["max_unlocked_level"] == 1 and body["level_count"] == 8
    assert [lv["unlocked"] for lv in body["levels"]] == [True] + [False] * 7
    assert [lv["premium"] for lv in body["levels"]] == [False] * 4 + [True] * 4
    assert body["levels"][0]["title"] == "Major yoki minor?"
    assert body["active_run"] is None and body["perfect_runs"] == 0


async def test_run_never_reveals_the_answers(client, sessionmaker):
    r = await client.post("/api/ear/runs", headers=auth(), json={"level": 1})
    assert r.status_code == 201, r.text
    body = r.json()
    assert len(body["questions"]) == 10 and body["answered"] == []
    text = r.text
    assert "answer" not in text.replace('"answered"', "")
    for q in body["questions"]:
        assert set(q) == {"question_id", "options", "voicing"}
        assert sorted(o["id"] for o in q["options"]) == ["maj", "min"]  # level 1: two options
        assert len(q["voicing"]) == 1 and len(q["voicing"][0]) == 6


async def test_four_options_from_level_two(client, sessionmaker):
    await set_progress(client, sessionmaker, 2)
    body = (await client.post("/api/ear/runs", headers=auth(), json={"level": 2})).json()
    for q in body["questions"]:
        assert len(q["options"]) == 4 and len({o["id"] for o in q["options"]}) == 4
        assert all(len(o["chords"]) == 1 for o in q["options"])


async def test_nine_of_ten_does_not_unlock(client, sessionmaker):
    result = await play_run(client, sessionmaker, level=1, wrong=1)
    assert (result["score"], result["perfect"], result["unlocked_level"]) == (9, False, None)
    assert result["max_unlocked_level"] == 1
    [m] = result["mistakes"]
    assert m["asked"]["id"] != m["answered"]["id"]
    # Level 1: the wrong quality is played on the same root, so both can be heard.
    assert m["asked"]["chords"][0]["root"] == m["answered"]["chords"][0]["root"]
    assert len(m["answered"]["voicing"][0]) == 6
    r = await client.post("/api/ear/runs", headers=auth(), json={"level": 2})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "level_locked"


async def test_ten_of_ten_unlocks_the_next_level(client, sessionmaker):
    result = await play_run(client, sessionmaker, level=1)
    assert (result["score"], result["perfect"], result["unlocked_level"]) == (10, True, 2)
    assert result["mistakes"] == []
    progress = (await client.get("/api/ear/progress", headers=auth())).json()
    assert progress["max_unlocked_level"] == 2
    assert progress["perfect_streak"] == 1 and progress["perfect_runs"] == 1
    assert progress["levels"][0]["best"] == 10 and progress["levels"][1]["unlocked"] is True
    # A worse run later keeps the best and the level, but ends the perfect streak.
    await play_run(client, sessionmaker, level=1, wrong=3)
    progress = (await client.get("/api/ear/progress", headers=auth())).json()
    assert progress["levels"][0]["best"] == 10 and progress["max_unlocked_level"] == 2
    assert progress["perfect_streak"] == 0
    summary = (await client.get("/api/practice/summary", headers=auth())).json()
    assert {"game": "ear_test", "chain_key": "level1", "value": 10} in summary["bests"]
    assert "ear_test" in summary["today"]["steps_done"]


async def test_answering_twice_is_a_conflict(client, sessionmaker):
    run = (await client.post("/api/ear/runs", headers=auth(), json={"level": 1})).json()
    url = f"/api/ear/runs/{run['run_id']}/answer"
    a = await client.post(url, headers=auth(), json={"question_id": 0, "choice": "maj"})
    assert a.status_code == 200
    again = await client.post(url, headers=auth(), json={"question_id": 0, "choice": "min"})
    assert again.status_code == 409 and again.json()["detail"]["code"] == "already_answered"


async def test_answers_go_in_order(client):
    run = (await client.post("/api/ear/runs", headers=auth(), json={"level": 1})).json()
    url = f"/api/ear/runs/{run['run_id']}/answer"
    skip = await client.post(url, headers=auth(), json={"question_id": 3, "choice": "maj"})
    assert skip.status_code == 409 and skip.json()["detail"]["code"] == "out_of_order"
    bad = await client.post(url, headers=auth(), json={"question_id": 0, "choice": "9:min"})
    assert bad.status_code == 422
    early = await client.post(f"/api/ear/runs/{run['run_id']}/finish", headers=auth())
    assert early.status_code == 409 and early.json()["detail"]["code"] == "unanswered"


async def test_expired_run_is_gone(client, sessionmaker):
    run = (await client.post("/api/ear/runs", headers=auth(), json={"level": 1})).json()
    async with sessionmaker() as s:
        await s.execute(update(EarRun).values(created_at=datetime.now(UTC) - timedelta(minutes=31)))
        await s.commit()
    r = await client.post(f"/api/ear/runs/{run['run_id']}/answer", headers=auth(),
                          json={"question_id": 0, "choice": "maj"})
    assert r.status_code == 410 and r.json()["detail"]["code"] == "run_expired"
    assert (await client.post(f"/api/ear/runs/{run['run_id']}/finish", headers=auth())).status_code == 410
    assert (await client.get("/api/ear/progress", headers=auth())).json()["active_run"] is None


async def test_locked_level_is_forbidden(client):
    r = await client.post("/api/ear/runs", headers=auth(), json={"level": 3})
    assert r.status_code == 403
    assert (await client.post("/api/ear/runs", headers=auth(), json={"level": 9})).status_code == 422


@pytest.mark.parametrize("level", [5, 8])
async def test_premium_levels_need_premium(client, sessionmaker, level):
    await set_progress(client, sessionmaker, 8)
    r = await client.post("/api/ear/runs", headers=auth(), json={"level": level})
    assert r.status_code == 402 and r.json()["detail"] == {"code": "premium_required", "paywall": True}
    await set_progress(client, sessionmaker, 8, premium=True)
    r = await client.post("/api/ear/runs", headers=auth(), json={"level": level})
    assert r.status_code == 201, r.text


async def test_unfinished_run_can_be_resumed(client, sessionmaker):
    run = (await client.post("/api/ear/runs", headers=auth(), json={"level": 1})).json()
    right = await _answers(sessionmaker, run["run_id"])
    await client.post(f"/api/ear/runs/{run['run_id']}/answer", headers=auth(),
                      json={"question_id": 0, "choice": right[0]})
    active = (await client.get("/api/ear/progress", headers=auth())).json()["active_run"]
    assert active["run_id"] == run["run_id"] and active["answered"] == 1
    again = (await client.get(f"/api/ear/runs/{run['run_id']}", headers=auth())).json()
    assert again["questions"] == run["questions"]
    assert [(a["question_id"], a["correct"]) for a in again["answered"]] == [(0, True)]
    # Starting another run replaces it.
    await client.post("/api/ear/runs", headers=auth(), json={"level": 1})
    old = await client.get(f"/api/ear/runs/{run['run_id']}", headers=auth())
    assert old.status_code == 410


async def test_finishing_twice_repeats_the_result(client, sessionmaker):
    first = await play_run(client, sessionmaker, level=1)
    async with sessionmaker() as s:
        run_id = await s.scalar(select(EarRun.id))
    second = (await client.post(f"/api/ear/runs/{run_id}/finish", headers=auth())).json()
    assert second == first
    progress = (await client.get("/api/ear/progress", headers=auth())).json()
    assert progress["perfect_streak"] == 1 and progress["max_unlocked_level"] == 2


async def test_progression_level(client, sessionmaker):
    await set_progress(client, sessionmaker, 8, premium=True)
    run = (await client.post("/api/ear/runs", headers=auth(), json={"level": 8})).json()
    assert run["kind"] == "progression"
    for q in run["questions"]:
        assert len(q["voicing"]) == 4 and len(q["options"]) == 4
        sets = {frozenset((c["root"], c["quality"]) for c in o["chords"]) for o in q["options"]}
        assert len(sets) == 1  # the same chords, only the order differs


async def test_someone_elses_run_is_not_found(client):
    run = (await client.post("/api/ear/runs", headers=auth(), json={"level": 1})).json()
    r = await client.post(f"/api/ear/runs/{run['run_id']}/finish", headers=auth(99))
    assert r.status_code == 404
