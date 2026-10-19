"""Song management, for Telegram ids listed in ADMIN_IDS only."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select

from chordb_common.models import ChordEvent, Song

from app.catalog import detail, replace_timeline, summaries
from app.deps import CurrentUser, Session, require_admin
from app.schemas import PublishIn, SongDetail, SongIn, SongPatch, SongSummary, TimelineIn

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
    song = Song()
    _apply(song, body.model_dump())
    session.add(song)
    await session.commit()
    await session.refresh(song)  # server defaults (id, created_at, is_published)
    return await detail(session, song, user)


@router.patch("/songs/{song_id}", response_model=SongDetail)
async def update_song(
    song_id: int, body: SongPatch, user: CurrentUser, session: Session
) -> SongDetail:
    changes = body.model_dump(exclude_unset=True)
    if any(v is None for v in changes.values()):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "fields cannot be null")
    song = await _song(session, song_id)
    _apply(song, changes)
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
