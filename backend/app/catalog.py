"""Song queries and timeline writes shared by the public and admin routes."""

from bisect import bisect_right
from collections.abc import Sequence

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from chordb_common.models import ChordEvent, Song, SongSection, User, UserSongProgress

from app.schemas import (
    ChordEventOut,
    ChordModel,
    SectionOut,
    SongDetail,
    SongSummary,
    TimelineIn,
    is_admin,
)

PREVIEW_LEN = 4


def visible(user: User) -> list[ColumnElement[bool]]:
    """WHERE clauses for songs this user may see: admins also see drafts."""
    return [] if is_admin(user) else [Song.is_published.is_(True)]


def can_open(song: Song, user: User) -> bool:
    return not song.is_premium or user.has_premium or is_admin(user)


async def get_visible(session: AsyncSession, song_id: int, user: User) -> Song:
    song = await session.scalar(select(Song).where(Song.id == song_id, *visible(user)))
    if song is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "song not found")
    return song


async def previews(session: AsyncSession, song_ids: Sequence[int]) -> dict[int, list[ChordModel]]:
    """First PREVIEW_LEN distinct chords of each song, in timeline order."""
    out: dict[int, list[ChordModel]] = {i: [] for i in song_ids}
    if not song_ids:
        return out
    rows = await session.execute(
        select(ChordEvent.song_id, ChordEvent.root, ChordEvent.quality)
        .where(ChordEvent.song_id.in_(song_ids))
        .order_by(ChordEvent.song_id, ChordEvent.time_sec)
    )
    for song_id, root, quality in rows:
        chords = out[song_id]
        chord = ChordModel(root=root, quality=quality)
        if len(chords) < PREVIEW_LEN and chord not in chords:
            chords.append(chord)
    return out


async def summaries(session: AsyncSession, songs: Sequence[Song], user: User) -> list[SongSummary]:
    pre = await previews(session, [s.id for s in songs])
    return [
        SongSummary.build(s, locked=not can_open(s, user), preview=pre[s.id]) for s in songs
    ]


async def detail(session: AsyncSession, song: Song, user: User) -> SongDetail:
    sections = (
        await session.scalars(
            select(SongSection).where(SongSection.song_id == song.id).order_by(SongSection.order)
        )
    ).all()
    events = (
        await session.scalars(
            select(ChordEvent).where(ChordEvent.song_id == song.id).order_by(ChordEvent.time_sec)
        )
    ).all()
    position = await session.scalar(
        select(UserSongProgress.position_sec).where(
            UserSongProgress.user_id == user.id, UserSongProgress.song_id == song.id
        )
    )
    (summary,) = await summaries(session, [song], user)
    return SongDetail(
        **summary.model_dump(),
        youtube_id=song.youtube_id,
        sections=[
            SectionOut(id=s.id, order=s.order, title=s.title, start_sec=s.start_sec)
            for s in sections
        ],
        events=[
            ChordEventOut(
                time_sec=e.time_sec, section_id=e.section_id, root=e.root, quality=e.quality
            )
            for e in events
        ],
        position_sec=position,
    )


def _reject(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail)


async def replace_timeline(session: AsyncSession, song: Song, timeline: TimelineIn) -> None:
    """Swap the song's sections and chord events for `timeline`, validated.

    Each event belongs to the last section starting at or before it. The caller commits.
    """
    sections = sorted(timeline.sections, key=lambda s: s.start_sec)
    events = sorted(timeline.events, key=lambda e: e.time_sec)
    starts = [s.start_sec for s in sections]
    times = [e.time_sec for e in events]

    if len(set(starts)) != len(starts):
        raise _reject("two sections start at the same time")
    if len(set(times)) != len(times):
        raise _reject("two chord events at the same time")
    if any(t > song.duration_sec for t in starts + times):
        raise _reject("time beyond the end of the song")
    if sections and times and times[0] < starts[0]:
        raise _reject("chord event before the first section")

    await session.execute(delete(ChordEvent).where(ChordEvent.song_id == song.id))
    await session.execute(delete(SongSection).where(SongSection.song_id == song.id))

    rows = [
        SongSection(song_id=song.id, order=i, title=s.title, start_sec=s.start_sec)
        for i, s in enumerate(sections)
    ]
    session.add_all(rows)
    await session.flush()  # assigns section ids

    session.add_all(
        ChordEvent(
            song_id=song.id,
            section_id=rows[bisect_right(starts, e.time_sec) - 1].id if rows else None,
            time_sec=e.time_sec,
            root=e.root,
            quality=e.quality,
        )
        for e in events
    )
