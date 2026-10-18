import asyncio
import time
from collections import Counter
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError, TelegramRetryAfter
from aiogram.methods import SendMessage
from sqlalchemy import select

from chordb_common.models import Notification, NotificationStatus, NotificationType, User
from chordb_common.repo import mark_bot_started, upsert_user

from chordb_bot import jobs
from chordb_bot.notify import Notifier, RateLimiter, WebAppButton

METHOD = SendMessage(chat_id=0, text="x")


class FakeBot:
    """Records sends; `script[chat_id]` is a list of exceptions to raise before succeeding."""

    def __init__(self, script: dict[int, list[Exception]] | None = None) -> None:
        self.script = script or {}
        self.sent: list[tuple[int, str]] = []

    async def send_message(self, chat_id: int, text: str, reply_markup=None):
        errors = self.script.get(chat_id, [])
        if errors:
            raise errors.pop(0)
        self.sent.append((chat_id, text))
        return SimpleNamespace(message_id=len(self.sent))


async def make_user(sm, tg_id: int, *, started=True, age=timedelta(hours=25), **fields) -> User:
    async with sm() as s:
        u = await upsert_user(s, telegram_id=tg_id, first_name=f"U{tg_id}")
        if started:
            await mark_bot_started(s, u.id)
        u = await s.get(User, u.id, populate_existing=True)
        u.created_at = datetime.now(UTC) - age
        for k, v in fields.items():
            setattr(u, k, v)
        await s.commit()
        return u


async def test_rate_limiter_spacing() -> None:
    limiter = RateLimiter(rate=100)
    start = time.monotonic()
    await asyncio.gather(*(limiter.wait() for _ in range(21)))
    # 21 calls at 100/s: first immediate, then 20 gaps of 10 ms.
    assert time.monotonic() - start >= 0.19


async def test_broadcast_handles_errors(sessionmaker) -> None:
    users = [await make_user(sessionmaker, i) for i in (1, 2, 3, 4)]
    bot = FakeBot(
        {
            2: [TelegramForbiddenError(METHOD, "Forbidden: bot was blocked by the user")],
            3: [TelegramRetryAfter(METHOD, "Too Many Requests", retry_after=0)],
            4: [TelegramBadRequest(METHOD, "Bad Request: chat not found")],
        }
    )
    notifier = Notifier(bot, sessionmaker, rate=1000)
    counts = await notifier.broadcast(users, "salom", WebAppButton("Ochish"))

    assert counts == Counter({NotificationStatus.SENT: 2, NotificationStatus.BLOCKED: 1,
                              NotificationStatus.FAILED: 1})
    assert sorted(c for c, _ in bot.sent) == [1, 3]

    async with sessionmaker() as s:
        rows = {n.user_id: n for n in await s.scalars(select(Notification))}
        assert len(rows) == 4
        assert rows[users[1].id].status == NotificationStatus.BLOCKED
        assert rows[users[2].id].status == NotificationStatus.SENT
        assert rows[users[3].id].error == "Bad Request: chat not found"
        blocked = await s.get(User, users[1].id)
        assert blocked.is_blocked_bot is True


async def test_send_to_user(sessionmaker) -> None:
    await make_user(sessionmaker, 10)
    bot = FakeBot()
    notifier = Notifier(bot, sessionmaker, rate=1000)
    assert await notifier.send_to_user(10, "hi") == NotificationStatus.SENT
    assert await notifier.send_to_user(999, "hi") == NotificationStatus.FAILED
    assert bot.sent == [(10, "hi")]


async def test_start_unblocks(sessionmaker) -> None:
    u = await make_user(sessionmaker, 20, is_blocked_bot=True)
    async with sessionmaker() as s:
        await mark_bot_started(s, u.id)
        await s.commit()
        assert (await s.get(User, u.id)).is_blocked_bot is False


async def test_welcome_followup_selection(sessionmaker) -> None:
    now = datetime.now(UTC)
    await make_user(sessionmaker, 100)                                     # eligible
    await make_user(sessionmaker, 101, started=False, allows_write_to_pm=True)  # eligible
    await make_user(sessionmaker, 102, tuner_opened_at=now)               # opened tuner
    await make_user(sessionmaker, 103, age=timedelta(hours=2))            # too new
    await make_user(sessionmaker, 104, age=timedelta(days=30))            # too old
    await make_user(sessionmaker, 105, is_blocked_bot=True)               # blocked
    await make_user(sessionmaker, 106, started=False)                     # can't message
    await make_user(sessionmaker, 107, notifications_enabled=False)       # opted out

    bot = FakeBot()
    notifier = Notifier(bot, sessionmaker, rate=1000)
    counts = await jobs.welcome_followup(notifier)
    assert counts == Counter({NotificationStatus.SENT: 2})
    assert sorted(c for c, _ in bot.sent) == [100, 101]
    assert "U100" in dict(bot.sent)[100]

    # Never twice.
    assert await jobs.welcome_followup(notifier) == Counter()


async def test_weekly_reminder(sessionmaker) -> None:
    await make_user(sessionmaker, 200, age=timedelta(hours=1))
    await make_user(sessionmaker, 201, notifications_enabled=False)
    await make_user(sessionmaker, 202, is_blocked_bot=True)

    bot = FakeBot()
    notifier = Notifier(bot, sessionmaker, rate=1000)
    assert await jobs.weekly_reminder(notifier) == Counter({NotificationStatus.SENT: 1})
    assert [c for c, _ in bot.sent] == [200]
    # A second run in the same week sends nothing.
    assert await jobs.weekly_reminder(notifier) == Counter()

    async with sessionmaker() as s:
        types = list(await s.scalars(select(Notification.type)))
    assert types == [NotificationType.WEEKLY_REMINDER]


@pytest.mark.parametrize("job", sorted(jobs.JOBS))
async def test_jobs_with_no_users(sessionmaker, job) -> None:
    assert await jobs.JOBS[job](Notifier(FakeBot(), sessionmaker)) == Counter()


def test_weekly_reminder_uses_notify_tz() -> None:
    scheduler = jobs.make_scheduler(Notifier(FakeBot(), None))
    trigger = scheduler.get_job("weekly_reminder").trigger
    assert str(trigger.timezone) == "Asia/Tashkent"
    fire = trigger.get_next_fire_time(None, datetime(2026, 10, 18, 0, 0, tzinfo=UTC))
    assert fire == datetime(2026, 10, 18, 14, 0, tzinfo=UTC)  # 19:00 Tashkent (UTC+5)
