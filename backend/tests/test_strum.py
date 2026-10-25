"""Strumming patterns, a song's strumming row and the rhythm trainer's progress."""

from sqlalchemy import select

from chordb_common.models import Analysis, AnalysisSource, AnalysisStatus, User

from tests.test_songs import ADMIN, AM, USER, auth, client, published_song, set_premium, song_body  # noqa: F401

POP, BALADA = 2, 3


async def test_patterns_are_seeded(client):
    r = await client.get("/api/strum-patterns", headers=auth())
    assert r.status_code == 200, r.text
    body = r.json()
    assert [(p["name"], p["slots"], p["is_premium"], p["locked"]) for p in body] == [
        ("Asosiy", "D-D-D-D-", False, False),
        ("Pop", "D-DU-UDU", False, False),
        ("Balada", "D-D-DUDU", True, True),
        ("Reggi", "-U-U-U-U", True, True),
    ]
    admin = (await client.get("/api/strum-patterns", headers=auth(ADMIN))).json()
    assert not any(p["locked"] for p in admin)


async def test_song_defaults_to_pop(client):
    song = await published_song(client)
    detail = (await client.get(f"/api/songs/{song['id']}", headers=auth())).json()
    assert detail["strum_pattern_id"] == POP
    assert [p["name"] for p in detail["strum_patterns"]] == ["Pop"]
    assert detail["time_signature"] == "4/4"
    assert detail["bpm"] is None and detail["bpm_detected"] is None and detail["beats"] is None
    assert all(e["strum_pattern_id"] is None for e in detail["events"])


async def test_admin_sets_pattern_bpm_and_section_patterns(client):
    r = await client.post(
        "/api/admin/songs", headers=auth(ADMIN),
        json=song_body(strum_pattern_id=BALADA, bpm=92, time_signature="3/4"),
    )
    assert r.status_code == 201, r.text
    song = r.json()
    assert (song["strum_pattern_id"], song["bpm"], song["time_signature"]) == (BALADA, 92, "3/4")

    timeline = {
        "sections": [],
        "events": [{"time_sec": 0, **AM}, {"time_sec": 8, **AM, "strum_pattern_id": 1}],
    }
    r = await client.put(f"/api/admin/songs/{song['id']}/events", headers=auth(ADMIN), json=timeline)
    assert r.status_code == 200, r.text
    body = r.json()
    assert [e["strum_pattern_id"] for e in body["events"]] == [None, 1]
    assert [p["name"] for p in body["strum_patterns"]] == ["Asosiy", "Balada"]

    # bpm can be cleared again (null), unlike the other fields.
    r = await client.patch(f"/api/admin/songs/{song['id']}", headers=auth(ADMIN), json={"bpm": None})
    assert r.status_code == 200 and r.json()["bpm"] is None
    r = await client.patch(f"/api/admin/songs/{song['id']}", headers=auth(ADMIN), json={"title": None})
    assert r.status_code == 422


async def test_unknown_pattern_or_metre_is_rejected(client):
    r = await client.post("/api/admin/songs", headers=auth(ADMIN), json=song_body(strum_pattern_id=99))
    assert r.status_code == 422
    r = await client.post("/api/admin/songs", headers=auth(ADMIN), json=song_body(time_signature="5/4"))
    assert r.status_code == 422
    song = await published_song(client)
    bad = {"sections": [], "events": [{"time_sec": 0, **AM, "strum_pattern_id": 99}]}
    r = await client.put(f"/api/admin/songs/{song['id']}/events", headers=auth(ADMIN), json=bad)
    assert r.status_code == 422


async def test_bpm_falls_back_to_the_analysis(client, sessionmaker):
    song = await published_song(client)
    await client.get("/api/me", headers=auth())
    async with sessionmaker() as s:
        uid = await s.scalar(select(User.id).where(User.telegram_id == USER))
        s.add(Analysis(
            user_id=uid, source=AnalysisSource.YOUTUBE, source_ref="https://youtu.be/dQw4w9WgXcQ",
            youtube_id="dQw4w9WgXcQ", status=AnalysisStatus.DONE, bpm=113.4, beats=[0.5, 1.03],
        ))
        await s.commit()
    detail = (await client.get(f"/api/songs/{song['id']}", headers=auth())).json()
    assert (detail["bpm"], detail["bpm_detected"]) == (None, 113.4)
    assert detail["beats"] == [0.5, 1.03]
    # The admin's own tempo wins; the beats are the video's and stay.
    await client.patch(f"/api/admin/songs/{song['id']}", headers=auth(ADMIN), json={"bpm": 100})
    detail = (await client.get(f"/api/songs/{song['id']}", headers=auth())).json()
    assert (detail["bpm"], detail["bpm_detected"]) == (100, None)
    assert detail["beats"] == [0.5, 1.03]


async def _post(client, pattern_id=POP, bpm=60, accuracy=0.95, who=USER):
    return await client.post(
        "/api/strum/progress", headers=auth(who),
        json={"pattern_id": pattern_id, "bpm": bpm, "accuracy": accuracy},
    )


def _pattern(body: dict, pattern_id: int = POP) -> dict:
    return next(p for p in body["patterns"] if p["pattern_id"] == pattern_id)


async def test_progress_climbs_the_ladder(client):
    body = (await client.get("/api/strum/progress", headers=auth())).json()
    assert body["ladder"] == [60, 80, 100, 120] and body["unlock_accuracy"] == 0.9
    assert _pattern(body)["unlocked_bpm"] == 60
    assert (body["mastered"], body["top_bpm"]) == (0, None)

    r = await _post(client, bpm=60, accuracy=0.8)
    assert r.status_code == 200, r.text
    assert _pattern(r.json())["unlocked_bpm"] == 60  # 80% isn't enough

    # Too fast for now.
    r = await _post(client, bpm=80)
    assert r.status_code == 403 and r.json()["detail"] == {"code": "tempo_locked", "unlocked_bpm": 60}

    for bpm, unlocked in [(60, 80), (80, 100), (100, 120), (120, 140)]:
        r = await _post(client, bpm=bpm)
        assert r.status_code == 200, r.text
        assert _pattern(r.json())["unlocked_bpm"] == unlocked
    body = r.json()
    assert _pattern(body)["mastered"] is True
    assert (body["mastered"], body["top_bpm"]) == (1, 120)
    assert _pattern(body, 1)["unlocked_bpm"] == 60  # other patterns start over


async def test_progress_keeps_the_best(client):
    await _post(client, accuracy=0.95)
    r = await _post(client, accuracy=0.5)
    assert _pattern(r.json())["best"] == {"60": 0.95}


async def test_premium_pattern_needs_premium(client, sessionmaker):
    r = await _post(client, pattern_id=BALADA)
    assert r.status_code == 402
    assert r.json()["detail"] == {"code": "premium_required", "paywall": True}
    await set_premium(sessionmaker, USER)
    assert (await _post(client, pattern_id=BALADA)).status_code == 200


async def test_progress_input_is_checked(client):
    assert (await _post(client, pattern_id=99)).status_code == 404
    assert (await _post(client, bpm=62)).status_code == 422  # not a multiple of 5
    assert (await _post(client, bpm=45)).status_code == 422
    assert (await _post(client, accuracy=1.2)).status_code == 422
