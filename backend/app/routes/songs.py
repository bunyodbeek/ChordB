from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert

from chordb_common.models import Difficulty, SearchMiss, Song, UserEventType, UserSongProgress

from app.catalog import can_open, detail, get_visible, summaries, visible
from app.deps import CurrentUser, Session
from app.premium import log_event
from app.schemas import ContinueOut, ProgressIn, SongDetail, SongsOut

router = APIRouter(prefix="/songs", tags=["songs"])

# Shorter searches are mostly someone still typing.
MISS_MIN_LEN = 3


def _like(q: str) -> str:
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


@router.get("", response_model=SongsOut)
async def list_songs(
    user: CurrentUser,
    session: Session,
    q: Annotated[str | None, Query(max_length=100)] = None,
    easy: bool = False,
    uzbek: bool = False,
    no_capo: bool = False,
) -> SongsOut:
    stmt = select(Song).where(*visible(user))
    if q and q.strip():
        pattern = _like(q.strip())
        stmt = stmt.where(
            or_(Song.title.ilike(pattern, escape="\\"), Song.artist.ilike(pattern, escape="\\"))
        )
    if easy:
        stmt = stmt.where(Song.difficulty == Difficulty.EASY)
    if uzbek:
        stmt = stmt.where(Song.language == "uz")
    if no_capo:
        stmt = stmt.where(Song.capo == 0)
    songs = (await session.scalars(stmt.order_by(Song.created_at.desc(), Song.id.desc()))).all()

    # Nothing in the catalog for a plain search: a content idea for the admin panel.
    query = (q or "").strip().lower()
    if not songs and len(query) >= MISS_MIN_LEN and not (easy or uzbek or no_capo):
        session.add(SearchMiss(user_id=user.id, query=query))
        await session.commit()

    # Most recent unfinished song, regardless of the filters above.
    recent = (
        await session.execute(
            select(Song, UserSongProgress.position_sec)
            .join(UserSongProgress, UserSongProgress.song_id == Song.id)
            .where(
                UserSongProgress.user_id == user.id,
                UserSongProgress.position_sec >= 1,
                UserSongProgress.position_sec < Song.duration_sec - 5,
                *visible(user),
            )
            .order_by(UserSongProgress.updated_at.desc())
            .limit(1)
        )
    ).first()
    resume = None
    if recent is not None and can_open(recent[0], user):
        (song_summary,) = await summaries(session, [recent[0]], user)
        resume = ContinueOut(song=song_summary, position_sec=recent[1])

    return SongsOut(continue_playing=resume, songs=await summaries(session, songs, user))


@router.get(
    "/{song_id}",
    response_model=SongDetail,
    responses={403: {"description": "Premium song: detail has paywall=true and the song summary"}},
)
async def get_song(song_id: int, user: CurrentUser, session: Session) -> SongDetail:
    song = await get_visible(session, song_id, user)
    await log_event(session, user, UserEventType.SONG_OPENED)
    await session.commit()
    if not can_open(song, user):
        (summary,) = await summaries(session, [song], user)
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            {"code": "premium_required", "paywall": True, "song": summary.model_dump(mode="json")},
        )
    return await detail(session, song, user)


@router.put("/{song_id}/progress", status_code=status.HTTP_204_NO_CONTENT)
async def save_progress(
    song_id: int, body: ProgressIn, user: CurrentUser, session: Session
) -> Response:
    song = await get_visible(session, song_id, user)
    if not can_open(song, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "premium song")
    position = min(body.position_sec, float(song.duration_sec))
    stmt = insert(UserSongProgress).values(user_id=user.id, song_id=song.id, position_sec=position)
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=[UserSongProgress.user_id, UserSongProgress.song_id],
            set_={"position_sec": stmt.excluded.position_sec, "updated_at": func.now()},
        )
    )
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
