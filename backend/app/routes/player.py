"""The player's per-user state: capo/key settings, chord fixes and chord suggestions.

A user's own analysed song is theirs to fix: the fixes are stored next to the analysis,
never in it (cache hits copy Analysis.events to other users). A catalog song is the
admin's: a fix there is a suggestion the admin accepts or rejects.
"""

from datetime import datetime, time

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from chordb_common.models import (
    Analysis,
    AnalysisStatus,
    ChordEvent,
    ChordSuggestion,
    SongEventOverride,
    SongKind,
    UserSongSettings,
)

from app.catalog import can_open, get_visible, player_settings
from app.deps import CurrentUser, Session
from app.premium import local_today, tz
from app.schemas import (
    AnalysisOut,
    ChordSuggestionIn,
    ChordSuggestionOut,
    EventFixesIn,
    PlayerSettingsIn,
)

router = APIRouter(tags=["player"])

SUGGESTIONS_PER_DAY = 30


def _error(code: int, name: str, **extra) -> HTTPException:
    return HTTPException(code, {"code": name, **extra})


async def own_analysis(session: Session, user_id: int, analysis_id: int) -> Analysis:
    row = await session.scalar(
        select(Analysis).where(Analysis.id == analysis_id, Analysis.user_id == user_id)
    )
    if row is None:
        raise _error(status.HTTP_404_NOT_FOUND, "analysis_not_found")
    return row


async def fixes_of(session: Session, analysis_id: int) -> dict:
    rows = await session.execute(
        select(SongEventOverride.event_index, SongEventOverride.root, SongEventOverride.quality).where(
            SongEventOverride.analysis_id == analysis_id
        )
    )
    return {i: (root, quality) for i, root, quality in rows}


async def analysis_out(session: Session, user_id: int, row: Analysis) -> AnalysisOut:
    """The analysis as its owner sees it: with their fixes and their player settings."""
    settings = await player_settings(session, user_id, SongKind.ANALYSIS, row.id)
    return AnalysisOut.build(row, await fixes_of(session, row.id), settings)


@router.put("/song-settings", status_code=status.HTTP_204_NO_CONTENT)
async def put_settings(body: PlayerSettingsIn, user: CurrentUser, session: Session) -> Response:
    if body.kind == SongKind.SONG:
        song = await get_visible(session, body.ref_id, user)
        if not can_open(song, user):
            raise _error(status.HTTP_403_FORBIDDEN, "premium_required")
    else:
        await own_analysis(session, user.id, body.ref_id)
    values = {"capo": body.capo, "shift": body.shift, "simple": body.simple}
    stmt = insert(UserSongSettings).values(user_id=user.id, kind=body.kind, ref_id=body.ref_id, **values)
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=[UserSongSettings.user_id, UserSongSettings.kind, UserSongSettings.ref_id],
            set_={**values, "updated_at": func.now()},
        )
    )
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/analyze/{analysis_id}/events", response_model=AnalysisOut)
async def fix_events(
    analysis_id: int, body: EventFixesIn, user: CurrentUser, session: Session
) -> AnalysisOut:
    """Fix chords of the user's own analysed song, at once. Stored as overrides."""
    row = await own_analysis(session, user.id, analysis_id)
    if row.status != AnalysisStatus.DONE or not row.events:
        raise _error(status.HTTP_409_CONFLICT, "analysis_not_done")
    if any(c.index >= len(row.events) for c in body.changes):
        raise _error(status.HTTP_422_UNPROCESSABLE_CONTENT, "unknown_event")
    for c in body.changes:
        stmt = insert(SongEventOverride).values(
            analysis_id=row.id, event_index=c.index, root=c.root, quality=c.quality
        )
        await session.execute(
            stmt.on_conflict_do_update(
                index_elements=[SongEventOverride.analysis_id, SongEventOverride.event_index],
                set_={"root": c.root, "quality": c.quality, "created_at": func.now()},
            )
        )
    await session.commit()
    return await analysis_out(session, user.id, row)


async def suggestions_today(session: Session, user_id: int) -> int:
    since = datetime.combine(local_today(), time.min, tzinfo=tz())
    return (
        await session.scalar(
            select(func.count()).select_from(ChordSuggestion).where(
                ChordSuggestion.user_id == user_id, ChordSuggestion.created_at >= since
            )
        )
    ) or 0


@router.post(
    "/songs/{song_id}/chord-suggestions",
    response_model=ChordSuggestionOut,
    status_code=status.HTTP_201_CREATED,
    responses={429: {"description": f"More than {SUGGESTIONS_PER_DAY} suggestions today"}},
)
async def suggest(
    song_id: int, body: ChordSuggestionIn, user: CurrentUser, session: Session
) -> ChordSuggestionOut:
    song = await get_visible(session, song_id, user)
    if not can_open(song, user):
        raise _error(status.HTTP_403_FORBIDDEN, "premium_required")
    used = await suggestions_today(session, user.id)
    if used >= SUGGESTIONS_PER_DAY:
        raise _error(status.HTTP_429_TOO_MANY_REQUESTS, "daily_limit", limit=SUGGESTIONS_PER_DAY)
    ids = sorted(set(body.event_ids))
    events = (
        await session.scalars(
            select(ChordEvent)
            .where(ChordEvent.song_id == song.id, ChordEvent.id.in_(ids))
            .order_by(ChordEvent.time_sec)
        )
    ).all()
    if len(events) != len(ids):
        raise _error(status.HTTP_422_UNPROCESSABLE_CONTENT, "unknown_event")
    first = events[0]
    row = ChordSuggestion(
        song_id=song.id,
        user_id=user.id,
        event_ids=ids,
        old_root=first.root,
        old_quality=first.quality,
        root=body.new_chord.root,
        quality=body.new_chord.quality,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return ChordSuggestionOut(
        id=row.id, status=row.status, remaining_today=SUGGESTIONS_PER_DAY - used - 1
    )

