"""/api/analyze and the worker against a real Postgres. The analysis itself is faked."""

import logging
import os
import time
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select, update

from chordb_common.config import get_settings
from chordb_common.models import Analysis, AnalysisSource, AnalysisStatus, User

from app.analysis import ENGINE_VERSION, AnalysisError
from app.deps import get_session
from app.init_data import sign_init_data
from app.main import app
from app.worker import ORPHAN_AGE_SEC, Worker

TOKEN = os.environ["BOT_TOKEN"]
ADMIN, USER, OTHER = 7, 42, 43
AM = {"root": 9, "quality": "min"}
F = {"root": 5, "quality": "maj"}

RESULT = {
    "engine_version": ENGINE_VERSION,
    "key": {"root": 9, "quality": "min", "confidence": 0.8},
    "bpm": 96.0,
    "duration_sec": 12.0,
    "beats": [0.5, 1.1, 1.7],
    "events": [
        {"start_sec": 0, "end_sec": 4, "chord": AM, "confidence": 0.9},
        {"start_sec": 4, "end_sec": 8, "chord": F, "confidence": 0.8},
        {"start_sec": 8, "end_sec": 10, "chord": AM, "confidence": 0.9},
        {"start_sec": 10, "end_sec": 12, "chord": None, "confidence": 0.7},
    ],
}


class FakeSlot:
    def __init__(self, result=RESULT, error: str | None = None):
        self.result, self.error, self.jobs = result, error, []

    def run(self, job, timeout):
        self.jobs.append(job)
        if self.error:
            raise AnalysisError(self.error, "boom")
        return self.result


@pytest.fixture
def media_dir(tmp_path, monkeypatch):
    d = tmp_path / "media"
    monkeypatch.setattr(get_settings(), "media_dir", str(d))
    return d


@pytest.fixture
async def client(sessionmaker, media_dir) -> AsyncIterator[httpx.AsyncClient]:
    async def _session():
        async with sessionmaker() as s:
            yield s

    app.dependency_overrides[get_session] = _session
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


def worker(sessionmaker, media_dir, slot=None) -> Worker:
    return Worker(sessionmaker, [slot or FakeSlot()], timeout=5, media_dir=media_dir)


def auth(user_id: int = USER) -> dict[str, str]:
    u = {"id": user_id, "first_name": "Bunyod", "language_code": "uz"}
    raw = sign_init_data({"user": u, "auth_date": str(int(time.time()))}, TOKEN)
    return {"Authorization": f"tma {raw}"}


def upload(data: bytes = b"RIFF fake audio", name="qoshiq.mp3", mime="audio/mpeg"):
    return {"files": {"file": (name, data, mime)}}


async def post_file(client, user=USER, **kw) -> httpx.Response:
    return await client.post("/api/analyze", headers=auth(user), **upload(**kw))


# --- upload, worker, result --------------------------------------------------------------


async def test_upload_queue_run_and_fetch(client, sessionmaker, media_dir, caplog):
    caplog.set_level(logging.INFO, logger="chordb")
    r = await post_file(client)
    assert r.status_code == 202, r.text
    job = r.json()
    assert job["status"] == "queued" and job["source"] == "upload"
    assert job["source_ref"] == "qoshiq.mp3" and job["title"] == "qoshiq"
    assert job["events"] is None and job["cache_hit"] is False
    files = list(media_dir.iterdir())
    assert len(files) == 1 and files[0].suffix == ".mp3"

    slot = FakeSlot()
    assert await worker(sessionmaker, media_dir, slot).run_once()
    assert slot.jobs[0]["media_path"] == str(files[0])
    assert list(media_dir.iterdir()) == []  # media deleted right after the analysis

    r = await client.get(f"/api/analyze/{job['id']}", headers=auth())
    assert r.status_code == 200
    done = r.json()
    assert done["status"] == "done"
    assert done["key"] == AM and done["bpm"] == 96.0 and done["duration_sec"] == 12.0
    assert done["events"] == RESULT["events"]
    assert done["beats"] == RESULT["beats"]
    assert done["chords_preview"] == [AM, F]
    async with sessionmaker() as s:
        row = await s.get(Analysis, job["id"])
        assert row.media_path is None and row.engine_version == ENGINE_VERSION
        assert row.file_hash and row.finished_at and row.started_at

    lines = [r.getMessage() for r in caplog.records if r.name == "chordb.events"]
    assert any(m.startswith("event=analyze_request") and "cache_hit=False" in m for m in lines)
    assert any(m.startswith("event=analyze_done") and f"analysis_id={job['id']}" in m for m in lines)
    assert not await worker(sessionmaker, media_dir).run_once()  # queue is empty


async def test_failed_job(client, sessionmaker, media_dir, caplog):
    caplog.set_level(logging.INFO, logger="chordb")
    job = (await post_file(client)).json()
    await worker(sessionmaker, media_dir, FakeSlot(error="decode_failed")).run_once()
    r = (await client.get(f"/api/analyze/{job['id']}", headers=auth())).json()
    assert r["status"] == "failed" and r["error_code"] == "decode_failed"
    assert r["events"] is None
    assert list(media_dir.iterdir()) == []
    assert any("event=analyze_failed" in m and "error_code=decode_failed" in m
               for m in caplog.messages)


async def test_youtube_link(client, sessionmaker, media_dir):
    r = await client.post("/api/analyze", headers=auth(),
                          json={"youtube_url": "https://youtu.be/dQw4w9WgXcQ?si=x"})
    assert r.status_code == 202, r.text
    job = r.json()
    assert job["source"] == "youtube" and job["youtube_id"] == "dQw4w9WgXcQ"
    assert job["source_ref"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

    class Downloading(FakeSlot):
        def run(self, job, timeout):
            d = Path(job["work_dir"])  # the job downloads here
            d.mkdir(parents=True)
            (d / "dQw4w9WgXcQ.webm").write_bytes(b"audio")
            return super().run(job, timeout)

    slot = Downloading(result={**RESULT, "title": "Never Gonna Give You Up"})
    await worker(sessionmaker, media_dir, slot).run_once()
    assert slot.jobs[0] == {
        "source": "youtube", "media_path": None, "youtube_id": "dQw4w9WgXcQ",
        "work_dir": str(media_dir / f"yt-{job['id']}"),
    }
    assert list(media_dir.iterdir()) == []  # the download is gone
    done = (await client.get(f"/api/analyze/{job['id']}", headers=auth())).json()
    assert done["status"] == "done" and done["title"] == "Never Gonna Give You Up"

    for bad in ({"youtube_url": "https://vimeo.com/1"}, {"youtube_url": ""}, {"nope": 1}):
        r = await client.post("/api/analyze", headers=auth(), json=bad)
        assert r.status_code == 422 and r.json()["detail"]["code"] == "invalid_url"


# --- cache and duplicates ----------------------------------------------------------------


async def test_cache_hit_is_instant_and_free(client, sessionmaker, media_dir):
    first = (await post_file(client, data=b"same bytes")).json()
    await worker(sessionmaker, media_dir).run_once()

    # Another user, another file name, same bytes: served from the cache.
    r = await post_file(client, user=OTHER, data=b"same bytes", name="boshqa.m4a", mime="audio/mp4")
    assert r.status_code == 200
    hit = r.json()
    assert hit["id"] != first["id"]
    assert hit["status"] == "done" and hit["cache_hit"] is True
    assert hit["events"] == RESULT["events"] and hit["source_ref"] == "boshqa.m4a"
    assert list(media_dir.iterdir()) == []
    assert not await worker(sessionmaker, media_dir).run_once()  # no new job

    hist = (await client.get("/api/analyze/history", headers=auth(OTHER))).json()
    assert hist["remaining_today"] == 3  # cache hits are free
    assert [i["id"] for i in hist["items"]] == [hit["id"]]

    # A YouTube video is cached by its id, whatever the link looks like.
    await client.post("/api/analyze", headers=auth(), json={"youtube_url": "youtu.be/dQw4w9WgXcQ"})
    await worker(sessionmaker, media_dir).run_once()
    r = await client.post("/api/analyze", headers=auth(OTHER),
                          json={"youtube_url": "https://www.youtube.com/shorts/dQw4w9WgXcQ"})
    assert r.status_code == 200 and r.json()["cache_hit"] is True


async def test_old_engine_results_are_not_reused(client, sessionmaker, media_dir):
    await post_file(client, data=b"old")
    await worker(sessionmaker, media_dir).run_once()
    async with sessionmaker() as s:
        await s.execute(update(Analysis).values(engine_version="0.9"))
        await s.commit()
    r = await post_file(client, user=OTHER, data=b"old")
    assert r.status_code == 202 and r.json()["status"] == "queued"


async def test_duplicate_while_queued(client, media_dir):
    a = (await post_file(client, data=b"twice")).json()
    r = await post_file(client, data=b"twice")
    assert r.status_code == 202 and r.json()["id"] == a["id"]
    assert len(list(media_dir.iterdir())) == 1
    hist = (await client.get("/api/analyze/history", headers=auth())).json()
    assert hist["remaining_today"] == 2  # charged once


# --- limits -----------------------------------------------------------------------------


async def test_daily_limit(client, sessionmaker, media_dir):
    for i in range(3):
        assert (await post_file(client, data=f"song {i}".encode())).status_code == 202
    r = await post_file(client, data=b"song 4")
    assert r.status_code == 429
    assert r.json()["detail"] == {"code": "daily_limit", "limit": 3}
    assert len(list(media_dir.iterdir())) == 3  # the rejected file is gone

    # Failed analyses give the try back.
    await worker(sessionmaker, media_dir, FakeSlot(error="decode_failed")).run_once()
    hist = (await client.get("/api/analyze/history", headers=auth())).json()
    assert hist["remaining_today"] == 1 and hist["daily_limit"] == 3

    # Yesterday's analyses don't count.
    async with sessionmaker() as s:
        await s.execute(update(Analysis).values(created_at=datetime.now(UTC) - timedelta(days=2)))
        await s.commit()
    hist = (await client.get("/api/analyze/history", headers=auth())).json()
    assert hist["remaining_today"] == 3


async def test_cache_hit_works_at_the_limit(client, sessionmaker, media_dir):
    await post_file(client, user=OTHER, data=b"popular")
    await worker(sessionmaker, media_dir).run_once()
    for i in range(3):
        await post_file(client, data=f"mine {i}".encode())
    assert (await post_file(client, data=b"popular")).status_code == 200


async def test_premium_and_admin_are_unlimited(client, sessionmaker):
    await client.get("/api/me", headers=auth())  # creates the user
    async with sessionmaker() as s:
        await s.execute(update(User).where(User.telegram_id == USER).values(is_premium=True))
        await s.commit()
    for user in (USER, ADMIN):
        for i in range(5):
            r = await post_file(client, user=user, data=f"{user} {i}".encode())
            assert r.status_code == 202
        hist = (await client.get("/api/analyze/history", headers=auth(user))).json()
        assert hist["remaining_today"] is None


async def test_upload_size_limit(client, media_dir, monkeypatch):
    monkeypatch.setattr(get_settings(), "analyze_max_upload_mb", 1)
    r = await post_file(client, data=b"x" * (1024 * 1024 + 1))
    assert r.status_code == 413 and r.json()["detail"]["code"] == "file_too_large"
    assert not media_dir.exists() or list(media_dir.iterdir()) == []
    assert (await post_file(client, data=b"x" * 1000)).status_code == 202


@pytest.mark.parametrize(
    ("name", "mime", "ok"),
    [
        ("a.mp3", "audio/mpeg", True),
        ("clip.mp4", "video/mp4", True),
        ("voice", "audio/ogg", True),
        ("song.m4a", "application/octet-stream", True),
        ("song.MOV", "", True),
        ("notes.txt", "text/plain", False),
        ("photo.jpg", "image/jpeg", False),
        ("song.mp3", "application/pdf", False),
        ("archive.zip", "application/octet-stream", False),
    ],
)
async def test_upload_types(client, name, mime, ok):
    r = await post_file(client, data=name.encode(), name=name, mime=mime)
    assert r.status_code == (202 if ok else 415), r.text
    if not ok:
        assert r.json()["detail"]["code"] == "unsupported_type"


async def test_bad_requests(client):
    r = await client.post("/api/analyze", headers=auth(), data={"x": "y"},
                          files={"other": ("a.mp3", b"1", "audio/mpeg")})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "no_file"
    r = await post_file(client, data=b"")
    assert r.status_code == 422 and r.json()["detail"]["code"] == "empty_file"
    r = await client.post(
        "/api/analyze", headers={**auth(), "content-type": "text/plain"}, content=b"hi"
    )
    assert r.status_code == 415
    assert (await client.post("/api/analyze", **upload())).status_code == 401


# --- access and history ---------------------------------------------------------------------


async def test_only_the_owner_sees_an_analysis(client):
    job = (await post_file(client)).json()
    assert (await client.get(f"/api/analyze/{job['id']}", headers=auth(OTHER))).status_code == 404
    assert (await client.get("/api/analyze/999999", headers=auth())).status_code == 404
    assert (await client.get("/api/analyze/history", headers=auth(OTHER))).json()["items"] == []


async def test_history_newest_first_last_20(client, sessionmaker, monkeypatch):
    monkeypatch.setattr(get_settings(), "analyze_free_per_day", 100)
    ids = [(await post_file(client, data=f"h{i}".encode())).json()["id"] for i in range(22)]
    hist = (await client.get("/api/analyze/history", headers=auth())).json()
    assert [i["id"] for i in hist["items"]] == ids[::-1][:20]
    assert "events" not in hist["items"][0]
    assert hist["remaining_today"] == 78


# --- worker housekeeping ----------------------------------------------------------------------


async def test_recover_after_a_worker_crash(client, sessionmaker, media_dir):
    up = (await post_file(client, data=b"kept")).json()
    gone = (await post_file(client, data=b"lost")).json()
    yt = (await client.post("/api/analyze", headers=auth(),
                            json={"youtube_url": "https://youtu.be/dQw4w9WgXcQ"})).json()
    async with sessionmaker() as s:
        await s.execute(update(Analysis).values(status=AnalysisStatus.RUNNING))
        lost_path = await s.scalar(select(Analysis.media_path).where(Analysis.id == gone["id"]))
        await s.commit()
    os.remove(lost_path)

    await worker(sessionmaker, media_dir).recover()
    async with sessionmaker() as s:
        status = dict((await s.execute(select(Analysis.id, Analysis.status))).all())
        err = await s.scalar(select(Analysis.error_code).where(Analysis.id == gone["id"]))
    assert status[up["id"]] == AnalysisStatus.QUEUED
    assert status[yt["id"]] == AnalysisStatus.QUEUED
    assert status[gone["id"]] == AnalysisStatus.FAILED and err == "interrupted"


async def test_sweep_deletes_only_stray_old_files(client, sessionmaker, media_dir):
    await post_file(client, data=b"waiting")  # referenced by a queued job
    (queued,) = list(media_dir.iterdir())
    stray, fresh = media_dir / "stray.mp3", media_dir / "fresh.mp3"
    stray.write_bytes(b"1")
    fresh.write_bytes(b"1")
    old = time.time() - ORPHAN_AGE_SEC - 60
    for f in (stray, queued):
        os.utime(f, (old, old))

    await worker(sessionmaker, media_dir).sweep()
    assert sorted(f.name for f in media_dir.iterdir()) == sorted([queued.name, fresh.name])


async def test_two_workers_never_claim_the_same_job(client, sessionmaker, media_dir):
    for i in range(3):
        await post_file(client, data=f"c{i}".encode())
    a, b = worker(sessionmaker, media_dir), worker(sessionmaker, media_dir)
    claimed = [await a.claim(), await b.claim(), await a.claim(), await b.claim()]
    ids = [c.id for c in claimed if c is not None]
    assert len(ids) == 3 == len(set(ids))
    assert all(c.source == AnalysisSource.UPLOAD for c in claimed if c)


# --- YouTube download health -------------------------------------------------------------


async def youtube_job(client, n: int) -> None:
    video_id = chr(ord("a") + n) * 11
    r = await client.post("/api/analyze", headers=auth(ADMIN),
                          json={"youtube_url": f"https://youtu.be/{video_id}"})
    assert r.status_code == 202, r.text


class Scripted:
    """Fails with the next scripted error code; None = success."""

    def __init__(self, outcomes: list[str | None]):
        self.outcomes = outcomes

    def run(self, job, timeout):
        code = self.outcomes.pop(0)
        if code:
            raise AnalysisError(code, f"ERROR: {code} detail")
        return RESULT


async def test_alert_after_three_youtube_failures_in_a_row(client, sessionmaker, media_dir, caplog):
    caplog.set_level(logging.INFO, logger="chordb")
    alerts: list[str] = []

    async def alert(text):
        alerts.append(text)

    # blocked, unknown -> 2; not_found means YouTube answers -> reset; decode_failed is
    # not a download problem; then blocked, unknown, blocked -> 3 in a row: one alert.
    outcomes = ["blocked", "unknown", "not_found", "blocked", "decode_failed", "unknown",
                "blocked", "blocked"]
    w = Worker(sessionmaker, [Scripted(outcomes)], timeout=5, media_dir=media_dir, alert=alert)
    for i in range(8):
        await youtube_job(client, i)
    for _ in range(7):
        assert await w.run_once()
    assert len(alerts) == 1
    assert "ketma-ket 3 ta" in alerts[0] and "blocked" in alerts[0]
    assert any("event=youtube_alert" in m for m in caplog.messages)

    await w.run_once()  # a 4th failure in the same streak: no second alert
    assert len(alerts) == 1 and w.youtube_failures == 4


async def test_success_resets_the_youtube_streak(client, sessionmaker, media_dir):
    alerts: list[str] = []

    async def alert(text):
        alerts.append(text)

    w = Worker(sessionmaker, [Scripted(["blocked", "blocked", None, "blocked", "blocked"])],
               timeout=5, media_dir=media_dir, alert=alert)
    for i in range(5):
        await youtube_job(client, i)
    for _ in range(5):
        await w.run_once()
    assert alerts == [] and w.youtube_failures == 2

    # Upload failures never count.
    await post_file(client, data=b"upload")
    w2 = Worker(sessionmaker, [FakeSlot(error="unknown")], timeout=5, media_dir=media_dir,
                alert=alert)
    w2.youtube_failures = 2
    await w2.run_once()
    assert alerts == [] and w2.youtube_failures == 2


async def test_sweep_deletes_stray_download_dirs(client, sessionmaker, media_dir):
    await youtube_job(client, 0)
    async with sessionmaker() as s:
        active_id = await s.scalar(select(Analysis.id))
    media_dir.mkdir(parents=True, exist_ok=True)
    old = time.time() - ORPHAN_AGE_SEC - 60
    for name in (f"yt-{active_id}", "yt-99999"):
        (media_dir / name).mkdir()
        (media_dir / name / "a.webm").write_bytes(b"1")
        os.utime(media_dir / name, (old, old))
    await worker(sessionmaker, media_dir).sweep()
    assert [f.name for f in media_dir.iterdir()] == [f"yt-{active_id}"]
