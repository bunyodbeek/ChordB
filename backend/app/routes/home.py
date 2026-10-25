"""The Asosiy page: today's recommendation, the streak, popular songs."""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter
from sqlalchemy import String, case, cast, distinct, func, select

from chordb_common.models import Difficulty, Song, UserEvent, UserEventType, UserSongProgress

from app.catalog import summaries, visible
from app.deps import CurrentUser, Session
from app.premium import local_today, plans
from app.routes.practice import streak_of
from app.schemas import HomeOut, is_admin

router = APIRouter(prefix="/home", tags=["home"])

POPULAR_LEN = 3
POPULAR_DAYS = 30  # "popular" = opened by the most people in this window

EASIEST_FIRST = case(
    {Difficulty.EASY: 0, Difficulty.MEDIUM: 1, Difficulty.HARD: 2}, value=Song.difficulty
)


async def _seen(session: Session, user_id: int) -> set[int]:
    """Songs this user has opened (by id in the event ref) or played."""
    refs = await session.scalars(
        select(UserEvent.ref).where(
            UserEvent.user_id == user_id,
            UserEvent.type.in_([UserEventType.SONG_OPENED, UserEventType.DEEP_LINK]),
            UserEvent.ref != "",
        )
    )
    played = await session.scalars(
        select(UserSongProgress.song_id).where(UserSongProgress.user_id == user_id)
    )
    return {int(r) for r in refs if r.isdigit()} | set(played)


@router.get("", response_model=HomeOut)
async def get_home(user: CurrentUser, session: Session) -> HomeOut:
    # The recommendation: the easiest song the user hasn't opened yet, among those they
    # can open (a locked song is no way to start).
    seen = await _seen(session, user.id)
    stmt = select(Song).where(*visible(user))
    if not (user.has_premium or is_admin(user)):
        stmt = stmt.where(Song.is_premium.is_(False))
    if seen:
        stmt = stmt.where(Song.id.not_in(seen))
    recommended = await session.scalar(
        stmt.order_by(EASIEST_FIRST, Song.created_at.desc(), Song.id.desc()).limit(1)
    )

    opens = (
        select(UserEvent.ref, func.count(distinct(UserEvent.user_id)).label("n"))
        .where(
            UserEvent.type == UserEventType.SONG_OPENED,
            UserEvent.ref != "",
            UserEvent.day >= local_today() - timedelta(days=POPULAR_DAYS),
        )
        .group_by(UserEvent.ref)
        .subquery()
    )
    popular = (
        await session.scalars(
            select(Song)
            .outerjoin(opens, opens.c.ref == cast(Song.id, String))
            .where(*visible(user))
            .order_by(func.coalesce(opens.c.n, 0).desc(), Song.created_at.desc(), Song.id.desc())
            .limit(POPULAR_LEN)
        )
    ).all()

    rec = await summaries(session, [recommended], user) if recommended else []
    streak = await streak_of(session, user, datetime.now(UTC))
    return HomeOut(
        recommended=rec[0] if rec else None,
        streak=streak.current,
        popular=await summaries(session, popular, user),
        premium_price_month=plans()["month"].price,
    )
