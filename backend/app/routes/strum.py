"""Strumming patterns and the rhythm trainer's progress (chordb_common.strum).

The webapp times the strokes against its own metronome and sends the accuracy of the
last four bars; the server keeps the best per pattern and tempo and decides which
tempos are open.
"""

from collections import defaultdict
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from chordb_common import strum
from chordb_common.models import StrumPattern, StrumProgress, User, UserEventType

from app.catalog import pattern_out
from app.deps import CurrentUser, Session
from app.premium import log_event
from app.schemas import (
    StrumPatternOut,
    StrumPatternProgress,
    StrumProgressIn,
    StrumProgressOut,
    is_admin,
)

router = APIRouter(tags=["strum"])

GAME_REF = "strum"  # the GAME_FINISH event's ref


def _error(code: int, name: str, **extra) -> HTTPException:
    return HTTPException(code, {"code": name, **extra})


async def _patterns(session: Session) -> list[StrumPattern]:
    return list(
        (await session.scalars(select(StrumPattern).order_by(StrumPattern.sort, StrumPattern.id))).all()
    )


async def _progress(session: Session, user: User) -> StrumProgressOut:
    rows = await session.execute(
        select(StrumProgress.pattern_id, StrumProgress.bpm, StrumProgress.best_accuracy).where(
            StrumProgress.user_id == user.id
        )
    )
    best: dict[int, dict[int, float]] = defaultdict(dict)
    for pattern_id, bpm, acc in rows:
        best[pattern_id][bpm] = acc
    patterns = [
        StrumPatternProgress(
            pattern_id=p.id,
            unlocked_bpm=strum.unlocked_bpm(best[p.id]),
            best=best[p.id],
            mastered=strum.mastered(best[p.id]),
        )
        for p in await _patterns(session)
    ]
    tops = [b for b in (strum.top_bpm(v) for v in best.values()) if b is not None]
    return StrumProgressOut(
        ladder=list(strum.LADDER),
        unlock_accuracy=strum.UNLOCK_ACCURACY,
        patterns=patterns,
        mastered=sum(p.mastered for p in patterns),
        top_bpm=max(tops, default=None),
    )


@router.get("/strum-patterns", response_model=list[StrumPatternOut])
async def list_patterns(user: CurrentUser, session: Session) -> list[StrumPatternOut]:
    return [pattern_out(p, user) for p in await _patterns(session)]


@router.get("/strum/progress", response_model=StrumProgressOut)
async def get_progress(user: CurrentUser, session: Session) -> StrumProgressOut:
    return await _progress(session, user)


@router.post(
    "/strum/progress",
    response_model=StrumProgressOut,
    responses={
        402: {"description": "Premium pattern"},
        403: {"description": "Tempo not unlocked yet"},
        404: {"description": "No such pattern"},
    },
)
async def post_progress(body: StrumProgressIn, user: CurrentUser, session: Session) -> StrumProgressOut:
    """Keep the better of this accuracy and the stored one for the pattern at this tempo."""
    pattern = await session.get(StrumPattern, body.pattern_id)
    if pattern is None:
        raise _error(status.HTTP_404_NOT_FOUND, "pattern_not_found")
    if pattern.is_premium and not (user.has_premium or is_admin(user)):
        raise _error(status.HTTP_402_PAYMENT_REQUIRED, "premium_required", paywall=True)

    rows = await session.execute(
        select(StrumProgress.bpm, StrumProgress.best_accuracy).where(
            StrumProgress.user_id == user.id, StrumProgress.pattern_id == pattern.id
        )
    )
    unlocked = strum.unlocked_bpm({bpm: acc for bpm, acc in rows})
    if body.bpm > unlocked:
        raise _error(status.HTTP_403_FORBIDDEN, "tempo_locked", unlocked_bpm=unlocked)

    now = datetime.now(UTC)
    stmt = insert(StrumProgress).values(
        user_id=user.id, pattern_id=pattern.id, bpm=body.bpm, best_accuracy=body.accuracy
    )
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=[StrumProgress.user_id, StrumProgress.pattern_id, StrumProgress.bpm],
            set_={
                "best_accuracy": func.greatest(StrumProgress.best_accuracy, stmt.excluded.best_accuracy),
                "updated_at": now,
            },
        )
    )
    await log_event(session, user, UserEventType.GAME_FINISH, ref=GAME_REF)
    await session.commit()
    return await _progress(session, user)
