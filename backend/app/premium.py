"""Premium periods, payment plans, and the per-day user events behind the admin stats."""

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from chordb_common.config import get_settings
from chordb_common.models import PremiumEvent, PremiumEventKind, User, UserEvent, UserEventType


@dataclass(frozen=True)
class Plan:
    id: str
    days: int
    price: int  # soʻm


def plans() -> dict[str, Plan]:
    s = get_settings()
    return {
        "month": Plan("month", 30, s.premium_price_month),
        "quarter": Plan("quarter", 90, s.premium_price_quarter),
    }


def tz() -> ZoneInfo:
    return ZoneInfo(get_settings().notify_tz)


def local_today() -> date:
    return datetime.now(tz()).date()


async def log_event(
    session: AsyncSession, user: User, type: UserEventType, ref: str = ""
) -> None:
    """Record that the user did `type` today; repeats on the same day are ignored.

    The caller commits.
    """
    await session.execute(
        insert(UserEvent)
        .values(user_id=user.id, type=type, day=local_today(), ref=ref)
        .on_conflict_do_nothing(constraint="uq_user_events_daily")
    )


def extend(
    session: AsyncSession,
    user: User,
    days: int | None,
    *,
    kind: PremiumEventKind,
    admin: User | None,
    payment_id: int | None = None,
    note: str | None = None,
) -> None:
    """Add `days` of premium after whatever the user still has; None = no end date.

    The caller commits.
    """
    if days is None:
        user.is_premium = True
    else:
        now = datetime.now(UTC)
        start = max(now, user.premium_until) if user.premium_until else now
        user.premium_until = start + timedelta(days=days)
    session.add(
        PremiumEvent(
            user_id=user.id,
            kind=kind,
            days=days,
            payment_id=payment_id,
            admin_id=admin.id if admin else None,
            note=note,
        )
    )


def revoke(session: AsyncSession, user: User, *, admin: User, note: str | None = None) -> None:
    user.is_premium = False
    user.premium_until = None  # the history keeps the revoke; nothing "expires" later
    session.add(
        PremiumEvent(user_id=user.id, kind=PremiumEventKind.REVOKED, admin_id=admin.id, note=note)
    )


def song_link(song_id: int) -> str | None:
    """The t.me link that opens the Mini App straight on a song; None if not configured."""
    s = get_settings()
    if not s.bot_username:
        return None
    path = f"{s.bot_username}/{s.webapp_short_name}" if s.webapp_short_name else s.bot_username
    return f"https://t.me/{path}?startapp=song_{song_id}"


def parse_song_param(start_param: str | None) -> int | None:
    if start_param and start_param.startswith("song_") and start_param[5:].isdigit():
        return int(start_param[5:])
    return None


# --- bot messages to the user (plain text) ---

def format_som(amount: int) -> str:
    return f"{amount:,}".replace(",", " ") + " soʻm"


def approved_text(user: User) -> str:
    if user.is_premium or user.premium_until is None:
        until = ""
    else:
        until = f" {user.premium_until.astimezone(tz()):%d.%m.%Y} gacha"
    return f"✅ Toʻlovingiz tasdiqlandi. Premium{until} faol — barcha qoʻshiqlar ochiq!"


def rejected_text(note: str | None) -> str:
    reason = f"\n\nSabab: {note}" if note else ""
    return (
        "❌ Toʻlovingizni tasdiqlay olmadik." + reason
        + "\n\nSavol boʻlsa, shu yerga yozing yoki chekni qayta yuboring."
    )


def granted_text(user: User) -> str:
    if user.is_premium or user.premium_until is None:
        return "🎁 Sizga ChordB Premium berildi — barcha qoʻshiqlar ochiq!"
    return (
        "🎁 Sizga ChordB Premium berildi: "
        f"{user.premium_until.astimezone(tz()):%d.%m.%Y} gacha barcha qoʻshiqlar ochiq!"
    )
