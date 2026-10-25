"""The player's per-user state: settings, fixes of own analyses, catalog suggestions."""

from sqlalchemy import select

from chordb_common.models import Analysis, AnalysisSource, AnalysisStatus, User

from app.routes.player import SUGGESTIONS_PER_DAY
from tests.test_songs import ADMIN, AM, C, USER, auth, client, published_song  # noqa: F401

EVENTS = [
    {"start_sec": 0.0, "end_sec": 2.0, "chord": {"root": 9, "quality": "min"}, "confidence": 0.9},
    {"start_sec": 2.0, "end_sec": 3.0, "chord": None, "confidence": 0.5},
    {"start_sec": 3.0, "end_sec": 5.0, "chord": {"root": 8, "quality": "maj"}, "confidence": 0.4},
]


async def _analysis(client, sessionmaker, who=USER) -> int:
    await client.get("/api/me", headers=auth(who))
    async with sessionmaker() as s:
        uid = await s.scalar(select(User.id).where(User.telegram_id == who))
        row = Analysis(
            user_id=uid, source=AnalysisSource.YOUTUBE, source_ref="https://youtu.be/x",
            youtube_id="abcdefghijk", status=AnalysisStatus.DONE, events=EVENTS, beats=[0.0, 0.5],
            key_root=1, key_quality="min", bpm=120.0, duration_sec=5.0,
        )
        s.add(row)
        await s.commit()
        return row.id


async def test_settings_are_kept_per_song(client, sessionmaker):
    song = await published_song(client)
    detail = (await client.get(f"/api/songs/{song['id']}", headers=auth())).json()
    assert detail["settings"] is None
    body = {"kind": "song", "ref_id": song["id"], "capo": 3, "shift": -2, "simple": True}
    assert (await client.put("/api/song-settings", headers=auth(), json=body)).status_code == 204
    body["capo"] = 2
    assert (await client.put("/api/song-settings", headers=auth(), json=body)).status_code == 204
    detail = (await client.get(f"/api/songs/{song['id']}", headers=auth())).json()
    assert detail["settings"] == {"capo": 2, "shift": -2, "simple": True}
    # Someone else's are their own.
    other = (await client.get(f"/api/songs/{song['id']}", headers=auth(ADMIN))).json()
    assert other["settings"] is None

    aid = await _analysis(client, sessionmaker)
    r = await client.put("/api/song-settings", headers=auth(), json={**body, "kind": "analysis", "ref_id": aid})
    assert r.status_code == 204
    assert (await client.get(f"/api/analyze/{aid}", headers=auth())).json()["settings"]["capo"] == 2
    # Not your analysis, out of range, unknown song.
    r = await client.put("/api/song-settings", headers=auth(ADMIN), json={**body, "kind": "analysis", "ref_id": aid})
    assert r.status_code == 404
    assert (await client.put("/api/song-settings", headers=auth(), json={**body, "capo": 13})).status_code == 422
    assert (await client.put("/api/song-settings", headers=auth(), json={**body, "ref_id": 999})).status_code == 404


async def test_fixing_own_analysis_keeps_the_cached_result(client, sessionmaker):
    aid = await _analysis(client, sessionmaker)
    r = await client.patch(
        f"/api/analyze/{aid}/events", headers=auth(),
        json={"changes": [{"index": 2, "root": 8, "quality": "min"}, {"index": 1, "root": 0, "quality": "maj"}]},
    )
    assert r.status_code == 200, r.text
    chords = [e["chord"] for e in r.json()["events"]]
    assert chords == [{"root": 9, "quality": "min"}, {"root": 0, "quality": "maj"}, {"root": 8, "quality": "min"}]
    assert [e["confidence"] for e in r.json()["events"]] == [0.9, 1.0, 1.0]
    assert (await client.get(f"/api/analyze/{aid}", headers=auth())).json()["events"][2]["chord"]["quality"] == "min"
    async with sessionmaker() as s:
        assert (await s.get(Analysis, aid)).events == EVENTS  # what cache hits copy
    bad = {"changes": [{"index": 3, "root": 0, "quality": "maj"}]}
    assert (await client.patch(f"/api/analyze/{aid}/events", headers=auth(), json=bad)).status_code == 422
    ok = {"changes": [{"index": 0, "root": 0, "quality": "maj"}]}
    assert (await client.patch(f"/api/analyze/{aid}/events", headers=auth(ADMIN), json=ok)).status_code == 404


async def test_suggestion_accepted_changes_the_song(client):
    song = await published_song(client)
    detail = (await client.get(f"/api/songs/{song['id']}", headers=auth())).json()
    ams = [e["id"] for e in detail["events"] if (e["root"], e["quality"]) == (9, "min")]
    assert len(ams) == 2
    r = await client.post(
        f"/api/songs/{song['id']}/chord-suggestions", headers=auth(),
        json={"event_ids": ams, "new_chord": C},
    )
    assert r.status_code == 201, r.text
    assert r.json()["remaining_today"] == SUGGESTIONS_PER_DAY - 1

    listed = (await client.get("/api/admin/chord-suggestions", headers=auth(ADMIN))).json()
    assert len(listed) == 1
    sug = listed[0]
    assert (sug["old_chord"], sug["new_chord"], sug["times"]) == (AM, C, [0.0, 15.0])
    assert (await client.get("/api/admin/chord-suggestions", headers=auth())).status_code == 403

    r = await client.post(f"/api/admin/chord-suggestions/{sug['id']}/accept", headers=auth(ADMIN))
    assert r.status_code == 200 and r.json()["status"] == "accepted"
    detail = (await client.get(f"/api/songs/{song['id']}", headers=auth())).json()
    assert [(e["root"], e["quality"]) for e in detail["events"] if e["id"] in ams] == [(0, "maj")] * 2
    assert (await client.post(f"/api/admin/chord-suggestions/{sug['id']}/reject", headers=auth(ADMIN))).status_code == 409
    assert (await client.get("/api/admin/chord-suggestions", headers=auth(ADMIN))).json() == []


async def test_suggestions_are_limited_per_day(client, sessionmaker):
    song = await published_song(client)
    detail = (await client.get(f"/api/songs/{song['id']}", headers=auth())).json()
    body = {"event_ids": [detail["events"][0]["id"]], "new_chord": C}
    url = f"/api/songs/{song['id']}/chord-suggestions"
    for _ in range(SUGGESTIONS_PER_DAY):
        assert (await client.post(url, headers=auth(), json=body)).status_code == 201
    r = await client.post(url, headers=auth(), json=body)
    assert r.status_code == 429
    assert r.json()["detail"] == {"code": "daily_limit", "limit": SUGGESTIONS_PER_DAY}
    assert (await client.post(url, headers=auth(ADMIN), json=body)).status_code == 201  # per user
    # Events from another song are refused.
    other = await published_song(client)
    other_event = (await client.get(f"/api/songs/{other['id']}", headers=auth(ADMIN))).json()["events"][0]["id"]
    r = await client.post(url, headers=auth(ADMIN), json={**body, "event_ids": [other_event]})
    assert r.status_code == 422


async def test_premium_song_needs_premium(client, sessionmaker):
    song = await published_song(client, is_premium=True)
    detail = (await client.get(f"/api/songs/{song['id']}", headers=auth(ADMIN))).json()
    body = {"event_ids": [detail["events"][0]["id"]], "new_chord": C}
    r = await client.post(f"/api/songs/{song['id']}/chord-suggestions", headers=auth(), json=body)
    assert r.status_code == 403
    settings = {"kind": "song", "ref_id": song["id"], "capo": 1, "shift": 0, "simple": False}
    assert (await client.put("/api/song-settings", headers=auth(), json=settings)).status_code == 403
