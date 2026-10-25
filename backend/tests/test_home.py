"""GET /api/home against a real Postgres: the recommendation, popular songs, streak."""

from tests.test_songs import ADMIN, USER, auth, client, published_song, set_premium  # noqa: F401

OTHER = 43


async def home(client, user_id: int = USER) -> dict:
    r = await client.get("/api/home", headers=auth(user_id))
    assert r.status_code == 200, r.text
    return r.json()


async def test_empty_catalog(client):
    body = await home(client)
    assert body["recommended"] is None
    assert body["popular"] == []
    assert body["streak"] == 0
    assert body["premium_price_month"] > 0


async def test_recommends_the_easiest_unopened_song(client):
    hard = await published_song(client, title="Qiyin", difficulty="hard")
    easy = await published_song(client, title="Oson", difficulty="easy")
    medium = await published_song(client, title="Oʻrta", difficulty="medium")

    assert (await home(client))["recommended"]["id"] == easy["id"]
    assert (await client.get(f"/api/songs/{easy['id']}", headers=auth())).status_code == 200
    assert (await home(client))["recommended"]["id"] == medium["id"]
    assert (await client.get(f"/api/songs/{medium['id']}", headers=auth())).status_code == 200
    assert (await home(client))["recommended"]["id"] == hard["id"]
    assert (await client.get(f"/api/songs/{hard['id']}", headers=auth())).status_code == 200
    assert (await home(client))["recommended"] is None
    # Someone else's opens don't count for this user.
    assert (await home(client, OTHER))["recommended"]["id"] == easy["id"]


async def test_locked_songs_are_not_recommended(client, sessionmaker):
    premium = await published_song(client, title="Perfect", difficulty="easy", is_premium=True)
    free = await published_song(client, title="Yor-yor", difficulty="hard")

    assert (await home(client))["recommended"]["id"] == free["id"]
    await set_premium(sessionmaker, USER)
    assert (await home(client))["recommended"]["id"] == premium["id"]


async def test_popular_by_people_who_opened(client):
    songs = [await published_song(client, title=f"Song {i}") for i in range(4)]
    _, b, c, d = (s["id"] for s in songs)
    for user_id, song_id in [(USER, b), (OTHER, b), (USER, c), (USER, c)]:  # c twice by one user
        await client.get(f"/api/songs/{song_id}", headers=auth(user_id))

    popular = (await home(client))["popular"]
    # b (2 people), c (1), then the newest of the rest.
    assert [s["id"] for s in popular] == [b, c, d]
    assert all("locked" in s and "chords_preview" in s for s in popular)
