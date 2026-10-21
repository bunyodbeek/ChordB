"""Admin panel: users, premium and payment review. ADMIN_IDS only."""

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, status
from sqlalchemy import ColumnElement, and_, exists, func, or_, select
from sqlalchemy.orm import aliased

from chordb_common.models import (
    Analysis,
    Payment,
    PaymentStatus,
    PremiumEvent,
    PremiumEventKind,
    User,
    UserEvent,
    UserEventType,
    UserSongProgress,
)

from app.alerts import send_user_message
from app.deps import CurrentUser, Session, require_admin
from app.premium import approved_text, extend, granted_text, rejected_text, revoke
from app.routes.songs import _like
from app.schemas import (
    AdminPaymentOut,
    AdminUserDetail,
    AdminUserRow,
    AdminUserStats,
    AdminUsersOut,
    ApproveIn,
    GrantIn,
    HistoryItem,
    NoteIn,
    PaymentOut,
    UserBrief,
    UserFilter,
)

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])

PAGE = 50
ACTIVE_WINDOW = timedelta(days=7)


def premium_now(now: datetime) -> ColumnElement[bool]:
    # Never NULL (a NULL premium_until is "no"), so ~premium_now() works too.
    return or_(
        User.is_premium.is_(True),
        and_(User.premium_until.is_not(None), User.premium_until > now),
    )


def pending_exists() -> ColumnElement[bool]:
    return exists().where(Payment.user_id == User.id, Payment.status == PaymentStatus.PENDING)


def _filter(name: UserFilter, now: datetime) -> ColumnElement[bool] | None:
    match name:
        case "premium":
            return premium_now(now)
        case "active_free":
            return and_(User.last_seen_at >= now - ACTIVE_WINDOW, ~premium_now(now))
        case "pending":
            return pending_exists()
        case "blocked":
            return User.is_blocked_bot.is_(True)
    return None


def _search(q: str) -> ColumnElement[bool]:
    q = q.strip().lstrip("@")
    pattern = _like(q)
    cond = [
        User.first_name.ilike(pattern, escape="\\"),
        User.last_name.ilike(pattern, escape="\\"),
        User.username.ilike(pattern, escape="\\"),
    ]
    if q.isdigit():
        cond.append(User.telegram_id == int(q))
    return or_(*cond)


@router.get("/users", response_model=AdminUsersOut)
async def list_users(
    session: Session,
    filter: UserFilter = "all",
    q: Annotated[str | None, Query(max_length=100)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> AdminUsersOut:
    now = datetime.now(UTC)
    search = _search(q) if q and q.strip() else None

    names: tuple[UserFilter, ...] = ("all", "premium", "active_free", "pending", "blocked")
    count_cols = [
        func.count().filter(cond) if (cond := _filter(n, now)) is not None else func.count()
        for n in names
    ]
    counts = (await session.execute(select(*count_cols).select_from(User))).one()

    where = [c for c in (_filter(filter, now), search) if c is not None]
    total = await session.scalar(select(func.count()).select_from(User).where(*where))
    pending = pending_exists().label("pending")
    rows = (
        await session.execute(
            select(User, pending)
            .where(*where)
            # Payments waiting for a decision first, then the most recently active.
            .order_by(pending.desc(), User.last_seen_at.desc(), User.id.desc())
            .offset(offset)
            .limit(PAGE)
        )
    ).all()
    return AdminUsersOut(
        counts=dict(zip(names, counts, strict=True)),
        total=total or 0,
        items=[AdminUserRow.row(u, pending=p) for u, p in rows],
    )


async def _user(session: Session, user_id: int) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    return user


async def _detail(session: Session, user: User) -> AdminUserDetail:
    async def count(stmt) -> int:
        return (await session.scalar(stmt)) or 0

    stats = AdminUserStats(
        active_days=await count(
            select(func.count()).where(
                UserEvent.user_id == user.id, UserEvent.type == UserEventType.APP_OPENED
            )
        ),
        songs=await count(
            select(func.count()).where(UserSongProgress.user_id == user.id)
        ),
        analyses=await count(select(func.count()).where(Analysis.user_id == user.id)),
    )
    payments = (
        await session.scalars(
            select(Payment)
            .where(Payment.user_id == user.id)
            .order_by(Payment.created_at.desc(), Payment.id.desc())
        )
    ).all()
    pending = next((p for p in payments if p.status == PaymentStatus.PENDING), None)

    admin = aliased(User)
    events = (
        await session.execute(
            select(PremiumEvent, admin.first_name)
            .outerjoin(admin, admin.id == PremiumEvent.admin_id)
            .where(PremiumEvent.user_id == user.id)
            .order_by(PremiumEvent.created_at.desc(), PremiumEvent.id.desc())
        )
    ).all()
    history = [
        HistoryItem(kind=e.kind, days=e.days, note=e.note, admin_name=name, created_at=e.created_at)
        for e, name in events
    ]
    now = datetime.now(UTC)
    if not user.is_premium and user.premium_until and user.premium_until <= now:
        history.insert(
            0,
            HistoryItem(
                kind="expired", days=None, note=None, admin_name=None,
                created_at=user.premium_until,
            ),
        )
        history.sort(key=lambda h: h.created_at, reverse=True)

    return AdminUserDetail(
        user=AdminUserRow.row(user, pending=pending is not None),
        stats=stats,
        pending=PaymentOut.build(pending) if pending else None,
        payments=[PaymentOut.build(p) for p in payments],
        history=history,
    )


@router.get("/users/{user_id}", response_model=AdminUserDetail)
async def get_user(user_id: int, session: Session) -> AdminUserDetail:
    return await _detail(session, await _user(session, user_id))


@router.post("/users/{user_id}/premium", response_model=AdminUserDetail)
async def grant(
    user_id: int, body: GrantIn, admin: CurrentUser, session: Session, background: BackgroundTasks
) -> AdminUserDetail:
    user = await _user(session, user_id)
    extend(session, user, body.days, kind=PremiumEventKind.GRANTED, admin=admin, note=body.note)
    await session.commit()
    background.add_task(send_user_message, user.telegram_id, granted_text(user), web_app_path="/")
    return await _detail(session, user)


@router.post("/users/{user_id}/premium/revoke", response_model=AdminUserDetail)
async def revoke_premium(
    user_id: int, body: NoteIn, admin: CurrentUser, session: Session
) -> AdminUserDetail:
    user = await _user(session, user_id)
    revoke(session, user, admin=admin, note=body.note)
    await session.commit()
    return await _detail(session, user)


# --- payments -----------------------------------------------------------------------------

@router.get("/payments", response_model=list[AdminPaymentOut])
async def list_payments(
    session: Session,
    status_: Annotated[PaymentStatus, Query(alias="status")] = PaymentStatus.PENDING,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[AdminPaymentOut]:
    # Pending: oldest first, the queue order. Decided: newest first.
    order = (
        (Payment.created_at.asc(), Payment.id.asc())
        if status_ == PaymentStatus.PENDING
        else (Payment.decided_at.desc(), Payment.id.desc())
    )
    rows = (
        await session.execute(
            select(Payment, User)
            .join(User, User.id == Payment.user_id)
            .where(Payment.status == status_)
            .order_by(*order)
            .limit(limit)
        )
    ).all()
    return [admin_payment(p, u) for p, u in rows]


def admin_payment(p: Payment, u: User) -> AdminPaymentOut:
    return AdminPaymentOut(**PaymentOut.build(p).model_dump(), user=UserBrief.build(u))


async def _payment(session: Session, payment_id: int, *, lock: bool = False) -> Payment:
    # Locked while deciding, so two admins can't both approve one payment.
    payment = await session.get(Payment, payment_id, with_for_update=lock)
    if payment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "payment not found")
    return payment


@router.get("/payments/{payment_id}/receipt")
async def receipt(payment_id: int, session: Session) -> Response:
    payment = await _payment(session, payment_id)
    data = await session.scalar(select(Payment.receipt).where(Payment.id == payment.id))
    return Response(
        data,
        media_type=payment.receipt_type,
        headers={"Cache-Control": "private, max-age=3600"},
    )


def _decide(payment: Payment, admin: User, approved: bool, note: str | None) -> None:
    if payment.status != PaymentStatus.PENDING:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "already_decided"})
    payment.status = PaymentStatus.APPROVED if approved else PaymentStatus.REJECTED
    payment.decided_by = admin.id
    payment.decided_at = datetime.now(UTC)
    payment.note = note


@router.post("/payments/{payment_id}/approve", response_model=AdminUserDetail)
async def approve(
    payment_id: int,
    body: ApproveIn,
    admin: CurrentUser,
    session: Session,
    background: BackgroundTasks,
) -> AdminUserDetail:
    payment = await _payment(session, payment_id, lock=True)
    _decide(payment, admin, True, body.note)
    if body.days is not None:
        payment.days = body.days
    user = await _user(session, payment.user_id)
    extend(
        session, user, payment.days,
        kind=PremiumEventKind.PAID, admin=admin, payment_id=payment.id, note=body.note,
    )
    await session.commit()
    background.add_task(send_user_message, user.telegram_id, approved_text(user), web_app_path="/")
    return await _detail(session, user)


@router.post("/payments/{payment_id}/reject", response_model=AdminUserDetail)
async def reject(
    payment_id: int,
    body: NoteIn,
    admin: CurrentUser,
    session: Session,
    background: BackgroundTasks,
) -> AdminUserDetail:
    payment = await _payment(session, payment_id, lock=True)
    _decide(payment, admin, False, body.note)
    user = await _user(session, payment.user_id)
    session.add(
        PremiumEvent(
            user_id=user.id,
            kind=PremiumEventKind.REJECTED,
            payment_id=payment.id,
            admin_id=admin.id,
            note=body.note,
        )
    )
    await session.commit()
    background.add_task(send_user_message, user.telegram_id, rejected_text(body.note))
    return await _detail(session, user)
