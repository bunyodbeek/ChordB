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


# --- daily practice reminder ------------------------------------------------------------

from chordb_common.models import PracticeDay, UserEvent, UserEventType  # noqa: E402
from chordb_common.practice import local_date  # noqa: E402


async def practised(sm, user: User, *, at: datetime, days_ago: int = 1) -> None:
    """A practice step `days_ago` days before `at`, at the same time of day."""
    async with sm() as s:
        when = at - timedelta(days=days_ago)
        s.add(UserEvent(user_id=user.id, type=UserEventType.PRACTICE_STEP,
                        day=local_date(when, user.timezone), ref="tune", created_at=when))
        await s.commit()


# 20:10 in Tashkent (UTC+5): inside the default 20:00 hour.
EVENING = datetime(2026, 10, 21, 15, 10, tzinfo=UTC)


async def test_practice_reminder_selection(sessionmaker) -> None:
    due = await make_user(sessionmaker, 300)
    await practised(sessionmaker, due, at=EVENING)

    done = await make_user(sessionmaker, 301)
    await practised(sessionmaker, done, at=EVENING)
    async with sessionmaker() as s:
        s.add(PracticeDay(user_id=done.id, date=local_date(EVENING, None), steps_done=[], completed=True))
        await s.commit()

    off = await make_user(sessionmaker, 302, notifications_enabled=False)
    await practised(sessionmaker, off, at=EVENING)
    blocked = await make_user(sessionmaker, 303, is_blocked_bot=True)
    await practised(sessionmaker, blocked, at=EVENING)
    inactive = await make_user(sessionmaker, 304)
    await practised(sessionmaker, inactive, at=EVENING, days_ago=20)
    await make_user(sessionmaker, 305)  # never practised: no daily reminders

    bot = FakeBot()
    notifier = Notifier(bot, sessionmaker, rate=1000)
    counts = await jobs.practice_reminder(notifier, EVENING)
    assert [c for c, _ in bot.sent] == [300]
    assert counts == Counter({NotificationStatus.SENT: 1})
    assert "bugungi mashq" in bot.sent[0][1]

    # Max one a day, even though the job runs again within the hour.
    assert await jobs.practice_reminder(notifier, EVENING + timedelta(minutes=15)) == Counter()
    # The next evening is a new day: 301's practice was done yesterday, not today.
    bot.sent.clear()
    await jobs.practice_reminder(notifier, EVENING + timedelta(days=1))
    assert sorted(c for c, _ in bot.sent) == [300, 301]


async def test_practice_reminder_at_the_usual_hour(sessionmaker) -> None:
    u = await make_user(sessionmaker, 310)
    morning = datetime(2026, 10, 21, 3, 20, tzinfo=UTC)  # 08:20 Tashkent
    for d in (1, 2, 3):
        await practised(sessionmaker, u, at=morning, days_ago=d)

    notifier = Notifier(FakeBot(), sessionmaker, rate=1000)
    assert await jobs.practice_reminder(notifier, EVENING) == Counter()  # not at 20:00
    assert await jobs.practice_reminder(notifier, morning) == Counter({NotificationStatus.SENT: 1})


async def test_practice_reminder_uses_the_users_timezone(sessionmaker) -> None:
    u = await make_user(sessionmaker, 320, timezone="Europe/London")
    await practised(sessionmaker, u, at=EVENING)  # 16:10 London: their usual hour is 16
    notifier = Notifier(FakeBot(), sessionmaker, rate=1000)
    assert await jobs.practice_reminder(notifier, EVENING) == Counter({NotificationStatus.SENT: 1})


def test_practice_link() -> None:
    settings = jobs.get_settings()
    old = settings.bot_username, settings.webapp_short_name
    try:
        settings.bot_username, settings.webapp_short_name = "ChordBbot", "app"
        assert jobs.practice_link() == "https://t.me/ChordBbot/app?startapp=practice"
        settings.bot_username = ""
        assert jobs.practice_link() == "https://chordb.test/?startapp=practice"
    finally:
        settings.bot_username, settings.webapp_short_name = old
