"""Buying premium: pay by card transfer, upload the receipt, wait for an admin."""

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from chordb_common.config import get_settings
from chordb_common.models import Payment, PaymentStatus

from app.alerts import send_admin_alert
from app.deps import CurrentUser, Session
from app.premium import format_som, plans
from app.schemas import PaymentInfoOut, PaymentOut, PlanOut

router = APIRouter(prefix="/payments", tags=["payments"])

MAX_RECEIPT_BYTES = 5 * 1024 * 1024
RECEIPT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}


def _error(code: int, error_code: str) -> HTTPException:
    return HTTPException(code, {"code": error_code})


async def _latest(session: Session, user_id: int) -> Payment | None:
    return await session.scalar(
        select(Payment)
        .where(Payment.user_id == user_id)
        .order_by(Payment.created_at.desc(), Payment.id.desc())
        .limit(1)
    )


@router.get("", response_model=PaymentInfoOut)
async def info(user: CurrentUser, session: Session) -> PaymentInfoOut:
    s = get_settings()
    latest = await _latest(session, user.id)
    return PaymentInfoOut(
        card=s.payment_card,
        card_holder=s.payment_card_holder,
        plans=[PlanOut(id=p.id, days=p.days, price=p.price) for p in plans().values()],
        latest=PaymentOut.build(latest) if latest else None,
    )


@router.post(
    "",
    response_model=PaymentOut,
    status_code=status.HTTP_201_CREATED,
    responses={
        409: {"description": "detail.code = already_pending"},
        413: {"description": "detail.code = file_too_large"},
        415: {"description": "detail.code = unsupported_type"},
        422: {"description": "detail.code = unknown_plan | empty_file"},
    },
)
async def create(
    plan: Annotated[str, Form()],
    receipt: UploadFile,
    user: CurrentUser,
    session: Session,
    background: BackgroundTasks,
) -> PaymentOut:
    chosen = plans().get(plan)
    if chosen is None:
        raise _error(422, "unknown_plan")
    content_type = (receipt.content_type or "").split(";")[0].strip().lower()
    if content_type not in RECEIPT_TYPES:
        raise _error(415, "unsupported_type")
    data = await receipt.read(MAX_RECEIPT_BYTES + 1)
    if len(data) > MAX_RECEIPT_BYTES:
        raise _error(413, "file_too_large")
    if not data:
        raise _error(422, "empty_file")

    latest = await _latest(session, user.id)
    if latest is not None and latest.status == PaymentStatus.PENDING:
        raise _error(409, "already_pending")

    payment = Payment(
        user_id=user.id,
        plan=chosen.id,
        days=chosen.days,
        amount=chosen.price,
        receipt=data,
        receipt_type=content_type,
    )
    session.add(payment)
    try:
        await session.commit()
    except IntegrityError:  # a second upload raced this one
        raise _error(409, "already_pending") from None
    await session.refresh(payment)

    name = " ".join(filter(None, [user.first_name, user.last_name]))
    handle = f" (@{user.username})" if user.username else ""
    background.add_task(
        send_admin_alert,
        f"💳 Yangi toʻlov: {name}{handle} · {chosen.days} kun · {format_som(chosen.price)}",
        web_app_path=f"/admin#/users/{user.id}",
    )
    return PaymentOut.build(payment)
