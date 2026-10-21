"""Admin panel dashboard: headline numbers, sign-ups, the funnel, catalog requests."""

from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import distinct, func, select

from chordb_common.models import (
    Analysis,
    AnalysisSource,
    Payment,
    PaymentStatus,
    SearchMiss,
    Song,
    User,
    UserEvent,
    UserEventType,
)

from app.deps import Session, require_admin
from app.premium import local_today, song_link, tz
from app.routes.admin_users import admin_payment, premium_now
from app.schemas import (
    AdminStatsOut,
    CatalogRequest,
    DayCount,
    FunnelStep,
    Period,
    SongLinkOut,
)

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])

PERIOD_DAYS: dict[Period, int] = {"today": 1, "7d": 7, "30d": 30}
CHART_DAYS = 14
REQUEST_DAYS = 30
REQUESTS = 8
# A miss followed this soon by a longer one from the same user was them still typing.
TYPING_GAP = timedelta(minutes=2)


def _midnight(day: date) -> datetime:
    return datetime.combine(day, time(), tzinfo=tz())


@router.get("/stats", response_model=AdminStatsOut)
async def stats(session: Session, period: Period = "7d") -> AdminStatsOut:
    now = datetime.now(UTC)
    today = local_today()
    first_day = today - timedelta(days=PERIOD_DAYS[period] - 1)
    since = _midnight(first_day)

    async def scalar(stmt) -> int:
        return (await session.scalar(stmt)) or 0

    users_total, users_new, premium, active, active_free = (
        await session.execute(
            select(
                func.count(),
                func.count().filter(User.created_at >= since),
                func.count().filter(premium_now(now)),
                func.count().filter(User.last_seen_at >= since),
                func.count().filter(User.last_seen_at >= since, ~premium_now(now)),
            ).select_from(User)
        )
    ).one()

    month_start = _midnight(today.replace(day=1))
    revenue = await scalar(
        select(func.sum(Payment.amount)).where(
            Payment.status == PaymentStatus.APPROVED, Payment.decided_at >= month_start
        )
    )

    # Sign-ups per local day, bucketed here: Postgres may lack the tz database (pgserver on
    # Windows does). Days without any still get a bar.
    chart_from = today - timedelta(days=CHART_DAYS - 1)
    per_day: dict[date, int] = defaultdict(int)
    for created in await session.scalars(
        select(User.created_at).where(User.created_at >= _midnight(chart_from))
    ):
        per_day[created.astimezone(tz()).date()] += 1
    new_by_day = [
        DayCount(day=d, count=per_day.get(d, 0))
        for d in (chart_from + timedelta(days=i) for i in range(CHART_DAYS))
    ]

    async def reached(type: UserEventType) -> int:
        return await scalar(
            select(func.count(distinct(UserEvent.user_id))).where(
                UserEvent.type == type, UserEvent.day >= first_day
            )
        )

    async def paid(*statuses: PaymentStatus) -> int:
        stmt = select(func.count(distinct(Payment.user_id))).where(Payment.created_at >= since)
        if statuses:
            stmt = stmt.where(Payment.status.in_(statuses))
        return await scalar(stmt)

    funnel = [
        FunnelStep(step="opened", users=await reached(UserEventType.APP_OPENED)),
        FunnelStep(step="tuner", users=await reached(UserEventType.TUNER_OPENED)),
        FunnelStep(step="song", users=await reached(UserEventType.SONG_OPENED)),
        FunnelStep(step="premium_viewed", users=await reached(UserEventType.PREMIUM_VIEWED)),
        FunnelStep(step="payment_sent", users=await paid()),
        FunnelStep(step="approved", users=await paid(PaymentStatus.APPROVED)),
    ]

    pending_count = await scalar(
        select(func.count()).select_from(Payment).where(Payment.status == PaymentStatus.PENDING)
    )
    pending = (
        await session.execute(
            select(Payment, User)
            .join(User, User.id == Payment.user_id)
            .where(Payment.status == PaymentStatus.PENDING)
            .order_by(Payment.created_at, Payment.id)
            .limit(5)
        )
    ).all()

    return AdminStatsOut(
        period=period,
        users_total=users_total,
        users_new=users_new,
        premium=premium,
        active=active,
        active_free=active_free,
        revenue_month=revenue,
        new_by_day=new_by_day,
        funnel=funnel,
        pending_count=pending_count,
        pending=[admin_payment(p, u) for p, u in pending],
        requests=await catalog_requests(session, now - timedelta(days=REQUEST_DAYS)),
    )


async def catalog_requests(session: Session, since: datetime) -> list[CatalogRequest]:
    """Searches that found nothing and YouTube analyses of songs not in the catalog."""
    misses = (
        await session.execute(
            select(SearchMiss.user_id, SearchMiss.query, SearchMiss.created_at)
            .where(SearchMiss.created_at >= since)
            .order_by(SearchMiss.user_id, SearchMiss.created_at)
        )
    ).all()
    searchers: dict[str, set[int]] = defaultdict(set)
    for i, (user_id, query, at) in enumerate(misses):
        nxt = misses[i + 1] if i + 1 < len(misses) else None
        still_typing = (
            nxt is not None
            and nxt.user_id == user_id
            and nxt.created_at - at < TYPING_GAP
            and nxt.query != query
            and nxt.query.startswith(query)
        )
        if not still_typing:
            searchers[query].add(user_id)

    in_catalog = select(Song.youtube_id)
    analysed = (
        await session.execute(
            select(
                Analysis.youtube_id,
                func.max(Analysis.title),
                func.count(distinct(Analysis.user_id)),
            )
            .where(
                Analysis.source == AnalysisSource.YOUTUBE,
                Analysis.youtube_id.is_not(None),
                Analysis.youtube_id.not_in(in_catalog),
                Analysis.created_at >= since,
            )
            .group_by(Analysis.youtube_id)
        )
    ).all()

    requests = [
        CatalogRequest(title=q, users=len(u), searches=len(u), analyses=0, youtube_id=None)
        for q, u in searchers.items()
    ] + [
        CatalogRequest(
            title=title or youtube_id, users=n, searches=0, analyses=n, youtube_id=youtube_id
        )
        for youtube_id, title, n in analysed
    ]
    requests.sort(key=lambda r: (-r.users, r.title))
    return requests[:REQUESTS]


@router.get("/songs/{song_id}/link", response_model=SongLinkOut)
async def link_stats(song_id: int, session: Session) -> SongLinkOut:
    came = select(distinct(UserEvent.user_id)).where(
        UserEvent.type == UserEventType.DEEP_LINK, UserEvent.ref == str(song_id)
    )
    opened = await session.scalar(select(func.count()).select_from(came.subquery())) or 0
    paid = await session.scalar(
        select(func.count(distinct(Payment.user_id))).where(
            Payment.status == PaymentStatus.APPROVED, Payment.user_id.in_(came)
        )
    ) or 0
    return SongLinkOut(url=song_link(song_id), opened=opened, paid=paid)
