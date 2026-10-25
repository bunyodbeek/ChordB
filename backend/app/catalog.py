"""Song queries and timeline writes shared by the public and admin routes."""

from bisect import bisect_right
from collections.abc import Iterable, Sequence

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from chordb_common import strum
from chordb_common.difficulty import auto_difficulty
from chordb_common.models import (
    Analysis,
    AnalysisStatus,
    ChordEvent,
    Song,
    SongKind,
    SongSection,
    StrumPattern,
    User,
    UserSavedSong,
    UserSongProgress,
    UserSongSettings,
)

from app.schemas import (
    ChordEventOut,
    ChordModel,
    PlayerSettings,
    SectionOut,
    SongDetail,
    SongSummary,
    StrumPatternOut,
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
    ids = [s.id for s in songs]
    pre = await previews(session, ids)
    saved = (
        set(
            await session.scalars(
                select(UserSavedSong.song_id).where(
                    UserSavedSong.user_id == user.id, UserSavedSong.song_id.in_(ids)
                )
            )
        )
        if ids
        else set()
    )
    return [
        SongSummary.build(s, locked=not can_open(s, user), saved=s.id in saved, preview=pre[s.id])
        for s in songs
    ]


async def refresh_difficulty(session: AsyncSession, song: Song) -> None:
    """Recompute an automatic difficulty from the stored timeline. The caller commits."""
    if not song.difficulty_auto:
        return
    rows = (
        await session.execute(
            select(ChordEvent.root, ChordEvent.quality).where(ChordEvent.song_id == song.id)
        )
        if song.id is not None
        else []
    )
    song.difficulty = auto_difficulty(((r, q) for r, q in rows), song.capo)


def pattern_out(p: StrumPattern, user: User) -> StrumPatternOut:
    return StrumPatternOut(
        id=p.id,
        name=p.name,
        slots=p.slots,
        is_premium=p.is_premium,
        locked=p.is_premium and not (user.has_premium or is_admin(user)),
    )


async def check_patterns(session: AsyncSession, ids: Iterable[int | None]) -> None:
    """422 unless every id given is a strumming pattern."""
    wanted = {i for i in ids if i is not None}
    if not wanted:
        return
    found = set(await session.scalars(select(StrumPattern.id).where(StrumPattern.id.in_(wanted))))
    if wanted - found:
        raise _reject("unknown strum pattern")


async def detected_rhythm(
    session: AsyncSession, youtube_id: str
) -> tuple[float | None, list[float] | None]:
    """The tempo and beat times the beat tracker found in the newest finished analysis
    of the video; (None, None) when there is none."""
    row = (
        await session.execute(
            select(Analysis.bpm, Analysis.beats)
            .where(
                Analysis.youtube_id == youtube_id,
                Analysis.status == AnalysisStatus.DONE,
                Analysis.bpm.is_not(None),
            )
            .order_by(Analysis.finished_at.desc().nulls_last(), Analysis.id.desc())
            .limit(1)
        )
    ).first()
    return (row.bpm, row.beats) if row else (None, None)


async def player_settings(
    session: AsyncSession, user_id: int, kind: SongKind, ref_id: int
) -> PlayerSettings | None:
    row = await session.get(UserSongSettings, (user_id, kind, ref_id))
    return PlayerSettings(capo=row.capo, shift=row.shift, simple=row.simple) if row else None


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
    # The beats are the video's, so they hold whoever set the tempo.
    bpm_detected, beats = await detected_rhythm(session, song.youtube_id)
    pattern_id = song.strum_pattern_id or strum.DEFAULT_PATTERN_ID
    used = {pattern_id, *(e.strum_pattern_id for e in events if e.strum_pattern_id)}
    patterns = (
        await session.scalars(
            select(StrumPattern).where(StrumPattern.id.in_(used)).order_by(StrumPattern.sort)
        )
    ).all()
    if pattern_id not in {p.id for p in patterns}:
        pattern_id = None  # the default pattern was deleted: no strumming row
    return SongDetail(
        **summary.model_dump(),
        sections=[
            SectionOut(id=s.id, order=s.order, title=s.title, start_sec=s.start_sec)
            for s in sections
        ],
        events=[
            ChordEventOut(
                id=e.id,
                time_sec=e.time_sec,
                section_id=e.section_id,
                root=e.root,
                quality=e.quality,
                strum_pattern_id=e.strum_pattern_id,
            )
            for e in events
        ],
        position_sec=position,
        strum_pattern_id=pattern_id,
        strum_patterns=[pattern_out(p, user) for p in patterns],
        bpm=song.bpm,
        bpm_detected=None if song.bpm is not None else bpm_detected,
        beats=beats,
        time_signature=song.time_signature or strum.DEFAULT_TIME_SIGNATURE,
        settings=await player_settings(session, user.id, SongKind.SONG, song.id),
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
    await check_patterns(session, (e.strum_pattern_id for e in events))

    await session.execute(delete(ChordEvent).where(ChordEvent.song_id == song.id))
    await session.execute(delete(SongSection).where(SongSection.song_id == song.id))

    rows = [
        SongSection(song_id=song.id, order=i, title=s.title, start_sec=s.start_sec)
        for i, s in enumerate(sections)
    ]
    session.add_all(rows)
    await session.flush()  # assigns section ids

    if song.difficulty_auto:
        song.difficulty = auto_difficulty(((e.root, e.quality) for e in events), song.capo)
    session.add_all(
        ChordEvent(
            song_id=song.id,
            section_id=rows[bisect_right(starts, e.time_sec) - 1].id if rows else None,
            time_sec=e.time_sec,
            root=e.root,
            quality=e.quality,
            strum_pattern_id=e.strum_pattern_id,
        )
        for e in events
    )
