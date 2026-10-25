"""Song management, for Telegram ids listed in ADMIN_IDS only."""

from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, update

from chordb_common.models import ChordEvent, ChordSuggestion, Song, SuggestionStatus, User

from app.catalog import check_patterns, detail, refresh_difficulty, replace_timeline, summaries
from app.deps import CurrentUser, Session, require_admin
from app.schemas import (
    AdminSuggestionOut,
    ChordModel,
    PublishIn,
    SongDetail,
    SongIn,
    SongPatch,
    SongSummary,
    TimelineIn,
    UserBrief,
)

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


async def _song(session: Session, song_id: int) -> Song:
    song = await session.get(Song, song_id)
    if song is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "song not found")
    return song


def _apply(song: Song, fields: dict) -> None:
    key = fields.pop("key", None)
    if key is not None:
        song.key_root, song.key_quality = key["root"], key["quality"]
    difficulty = fields.pop("difficulty", None)
    if difficulty is not None:
        song.difficulty_auto = difficulty == "auto"
        if not song.difficulty_auto:
            song.difficulty = difficulty
    for name, value in fields.items():
        setattr(song, name, value)


@router.get("/songs", response_model=list[SongSummary])
async def list_all(user: CurrentUser, session: Session) -> list[SongSummary]:
    songs = (
        await session.scalars(select(Song).order_by(Song.created_at.desc(), Song.id.desc()))
    ).all()
    return await summaries(session, songs, user)


@router.post("/songs", response_model=SongDetail, status_code=status.HTTP_201_CREATED)
async def create_song(body: SongIn, user: CurrentUser, session: Session) -> SongDetail:
    await check_patterns(session, [body.strum_pattern_id])
    song = Song()
    _apply(song, body.model_dump())
    await refresh_difficulty(session, song)  # no chords yet: easy
    session.add(song)
    await session.commit()
    await session.refresh(song)  # server defaults (id, created_at, is_published)
    return await detail(session, song, user)


@router.patch("/songs/{song_id}", response_model=SongDetail)
async def update_song(
    song_id: int, body: SongPatch, user: CurrentUser, session: Session
) -> SongDetail:
    changes = body.model_dump(exclude_unset=True)
    if any(v is None for k, v in changes.items() if k not in SongPatch.NULLABLE):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "fields cannot be null")
    await check_patterns(session, [changes.get("strum_pattern_id")])
    song = await _song(session, song_id)
    _apply(song, changes)
    await refresh_difficulty(session, song)  # "auto" picked, or the capo moved
    await session.commit()
    return await detail(session, song, user)


@router.put("/songs/{song_id}/events", response_model=SongDetail)
async def put_timeline(
    song_id: int, body: TimelineIn, user: CurrentUser, session: Session
) -> SongDetail:
    song = await _song(session, song_id)
    await replace_timeline(session, song, body)
    await session.commit()
    return await detail(session, song, user)


@router.patch("/songs/{song_id}/publish", response_model=SongSummary)
async def publish(
    song_id: int, body: PublishIn, user: CurrentUser, session: Session
) -> SongSummary:
    song = await _song(session, song_id)
    if body.is_published:
        count = await session.scalar(
            select(func.count()).select_from(ChordEvent).where(ChordEvent.song_id == song.id)
        )
        if not count:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "song has no chord events")
    song.is_published = body.is_published
    await session.commit()
    (summary,) = await summaries(session, [song], user)
    return summary


# --- chord suggestions from users -------------------------------------------------------

async def _suggestion_out(session: Session, rows: list[ChordSuggestion]) -> list[AdminSuggestionOut]:
    if not rows:
        return []
    songs = {s.id: s for s in await session.scalars(select(Song).where(Song.id.in_({r.song_id for r in rows})))}
    users = {u.id: u for u in await session.scalars(select(User).where(User.id.in_({r.user_id for r in rows})))}
    event_ids = {i for r in rows for i in r.event_ids}
    times = dict(
        (await session.execute(select(ChordEvent.id, ChordEvent.time_sec).where(ChordEvent.id.in_(event_ids)))).all()
    )
    return [
        AdminSuggestionOut(
            id=r.id,
            song_id=r.song_id,
            song_title=songs[r.song_id].title,
            song_artist=songs[r.song_id].artist,
            youtube_id=songs[r.song_id].youtube_id,
            user=UserBrief.build(users[r.user_id]),
            times=sorted(times[i] for i in r.event_ids if i in times),
            old_chord=ChordModel(root=r.old_root, quality=r.old_quality),
            new_chord=ChordModel(root=r.root, quality=r.quality),
            status=r.status,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.get("/chord-suggestions", response_model=list[AdminSuggestionOut])
async def list_suggestions(
    session: Session,
    status_: Annotated[SuggestionStatus, Query(alias="status")] = SuggestionStatus.PENDING,
) -> list[AdminSuggestionOut]:
    rows = (
        await session.scalars(
            select(ChordSuggestion)
            .where(ChordSuggestion.status == status_)
            .order_by(ChordSuggestion.created_at, ChordSuggestion.id)
            .limit(200)
        )
    ).all()
    return await _suggestion_out(session, list(rows))


@router.post("/chord-suggestions/{suggestion_id}/{decision}", response_model=AdminSuggestionOut)
async def decide_suggestion(
    suggestion_id: int,
    decision: Literal["accept", "reject"],
    user: CurrentUser,
    session: Session,
) -> AdminSuggestionOut:
    """Accept: the events (those still in the song) get the suggested chord."""
    row = await session.get(ChordSuggestion, suggestion_id, with_for_update=True)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "suggestion not found")
    if row.status != SuggestionStatus.PENDING:
        raise HTTPException(status.HTTP_409_CONFLICT, "already decided")
    if decision == "accept":
        await session.execute(
            update(ChordEvent)
            .where(ChordEvent.song_id == row.song_id, ChordEvent.id.in_(row.event_ids))
            .values(root=row.root, quality=row.quality)
        )
        await refresh_difficulty(session, await _song(session, row.song_id))
    row.status = SuggestionStatus.ACCEPTED if decision == "accept" else SuggestionStatus.REJECTED
    row.decided_by, row.decided_at = user.id, datetime.now(UTC)
    await session.commit()
    (out,) = await _suggestion_out(session, [row])
    return out
