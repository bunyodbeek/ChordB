"""Scheduled notifications (APScheduler, running inside the bot process)."""

import logging
from collections import Counter
from datetime import UTC, datetime, timedelta

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import ColumnElement, and_, exists, func, or_, select

from chordb_common.config import get_settings
from chordb_common.models import (
    Notification,
    NotificationStatus,
    NotificationType,
    PracticeDay,
    Streak,
    User,
    UserEvent,
    UserEventType,
)
from chordb_common.practice import (
    StreakState,
    current_streak,
    day_bounds,
    local_date,
    reminder_due,
    usual_hour,
)

from chordb_bot import texts
from chordb_bot.notify import Notifier, WebAppButton

log = logging.getLogger(__name__)

WELCOME_DELAY = timedelta(hours=24)
# Don't follow up with users who signed up long before this feature shipped.
WELCOME_MAX_AGE = timedelta(days=7)
# Guards against a second weekly send if the job runs twice (restart, misfire).
WEEKLY_MIN_GAP = timedelta(days=6)

NOTIFICATIONS_OFF_CB = "notif:off"
NOTIFICATIONS_ON_CB = "notif:on"


def messageable() -> ColumnElement[bool]:
    return and_(
        User.is_blocked_bot.is_(False),
        or_(User.bot_started_at.is_not(None), User.allows_write_to_pm.is_(True)),
    )


def _already_got(type: NotificationType, since: datetime | None = None) -> ColumnElement[bool]:
    cond = [
        Notification.user_id == User.id,
        Notification.type == type,
        Notification.status == NotificationStatus.SENT,
    ]
    if since is not None:
        cond.append(Notification.sent_at >= since)
    return exists().where(*cond)


async def welcome_followup(notifier: Notifier) -> Counter:
    now = datetime.now(UTC)
    async with notifier.sessionmaker() as session:
        users = (
            await session.scalars(
                select(User).where(
                    messageable(),
                    User.notifications_enabled.is_(True),
                    User.tuner_opened_at.is_(None),
                    User.created_at <= now - WELCOME_DELAY,
                    User.created_at > now - WELCOME_MAX_AGE,
                    ~_already_got(NotificationType.WELCOME_FOLLOWUP),
                )
            )
        ).all()
    if not users:
        return Counter()
    return await notifier.broadcast(
        users,
        lambda u: texts.welcome_followup(u.first_name),
        WebAppButton(texts.OPEN_APP),
        type=NotificationType.WELCOME_FOLLOWUP,
    )


def weekly_markup() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=texts.OPEN_APP, web_app=WebAppInfo(url=get_settings().webapp_url)
                )
            ],
            [
                InlineKeyboardButton(
                    text=texts.NOTIFICATIONS_OFF_BUTTON, callback_data=NOTIFICATIONS_OFF_CB
                )
            ],
        ]
    )


async def weekly_reminder(notifier: Notifier) -> Counter:
    now = datetime.now(UTC)
    async with notifier.sessionmaker() as session:
        users = (
            await session.scalars(
                select(User).where(
                    messageable(),
                    User.notifications_enabled.is_(True),
                    ~_already_got(NotificationType.WEEKLY_REMINDER, since=now - WEEKLY_MIN_GAP),
                )
            )
        ).all()
    if not users:
        return Counter()
    return await notifier.broadcast(
        users, texts.WEEKLY_REMINDER, weekly_markup(), type=NotificationType.WEEKLY_REMINDER
    )


# Daily practice reminder: only for people who practise (a step in this window), at the
# hour they usually do, on days the practice isn't done yet; at most one a day.
PRACTICE_ACTIVE = timedelta(days=14)
PRACTICE_HOURS_FROM = timedelta(days=30)  # events the usual hour is learnt from


def practice_link() -> str:
    """Opens the Mini App on the Mashq tab."""
    s = get_settings()
    if s.bot_username:
        app = f"/{s.webapp_short_name}" if s.webapp_short_name else ""
        return f"https://t.me/{s.bot_username}{app}?startapp=practice"
    # No bot username configured: a Web App button; the webapp reads ?startapp= itself.
    return s.webapp_url.rstrip("/") + "/?startapp=practice"


def practice_markup() -> InlineKeyboardMarkup:
    link = practice_link()
    open_button = (
        InlineKeyboardButton(text=texts.PRACTICE_BUTTON, url=link)
        if link.startswith("https://t.me/")
        else InlineKeyboardButton(text=texts.PRACTICE_BUTTON, web_app=WebAppInfo(url=link))
    )
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [open_button],
            [InlineKeyboardButton(text=texts.NOTIFICATIONS_OFF_BUTTON, callback_data=NOTIFICATIONS_OFF_CB)],
        ]
    )


async def practice_reminder(notifier: Notifier, now: datetime | None = None) -> Counter:
    now = now or datetime.now(UTC)
    async with notifier.sessionmaker() as session:
        users = (
            await session.scalars(
                select(User).where(
                    messageable(),
                    User.notifications_enabled.is_(True),
                    exists().where(
                        UserEvent.user_id == User.id,
                        UserEvent.type == UserEventType.PRACTICE_STEP,
                        UserEvent.created_at >= now - PRACTICE_ACTIVE,
                    ),
                )
            )
        ).all()
        if not users:
            return Counter()
        ids = [u.id for u in users]
        step_times: dict[int, list[datetime]] = {}
        for user_id, at in await session.execute(
            select(UserEvent.user_id, UserEvent.created_at).where(
                UserEvent.user_id.in_(ids),
                UserEvent.type == UserEventType.PRACTICE_STEP,
                UserEvent.created_at >= now - PRACTICE_HOURS_FROM,
            )
        ):
            step_times.setdefault(user_id, []).append(at)
        last_sent = dict(
            (
                await session.execute(
                    select(Notification.user_id, func.max(Notification.sent_at))
                    .where(
                        Notification.user_id.in_(ids),
                        Notification.type == NotificationType.PRACTICE_REMINDER,
                        Notification.status == NotificationStatus.SENT,
                    )
                    .group_by(Notification.user_id)
                )
            ).all()
        )
        done = {
            (user_id, day)
            for user_id, day in await session.execute(
                select(PracticeDay.user_id, PracticeDay.date).where(
                    PracticeDay.user_id.in_(ids), PracticeDay.completed.is_(True)
                )
            )
        }
        streaks = {s.user_id: s for s in await session.scalars(select(Streak).where(Streak.user_id.in_(ids)))}

    due: list[User] = []
    streak_now: dict[int, int] = {}
    for u in users:
        today = local_date(now, u.timezone)
        if (u.id, today) in done:
            continue
        if not reminder_due(now, u.timezone, usual_hour(step_times.get(u.id, []), u.timezone)):
            continue
        sent = last_sent.get(u.id)
        if sent is not None and sent >= day_bounds(today, u.timezone)[0]:
            continue  # already reminded today
        row = streaks.get(u.id)
        state = (
            StreakState(row.current, row.best, row.last_practice_date, row.freezes_left, row.freezes_month)
            if row
            else StreakState()
        )
        streak_now[u.id] = current_streak(state, today, premium=u.has_premium)
        due.append(u)
    if not due:
        return Counter()
    return await notifier.broadcast(
        due,
        lambda u: texts.practice_reminder(u.first_name, streak_now[u.id]),
        practice_markup(),
        type=NotificationType.PRACTICE_REMINDER,
    )


JOBS = {"welcome": welcome_followup, "weekly": weekly_reminder, "practice": practice_reminder}


def make_scheduler(notifier: Notifier) -> AsyncIOScheduler:
    tz = get_settings().notify_tz
    scheduler = AsyncIOScheduler(timezone=tz)
    common = {"args": [notifier], "max_instances": 1, "coalesce": True}
    scheduler.add_job(
        welcome_followup,
        IntervalTrigger(minutes=15),
        id="welcome_followup",
        next_run_time=datetime.now(UTC) + timedelta(minutes=1),
        **common,
    )
    scheduler.add_job(
        practice_reminder,
        # Every user's hour is checked a few times; the once-a-day rule stops repeats.
        IntervalTrigger(minutes=15),
        id="practice_reminder",
        next_run_time=datetime.now(UTC) + timedelta(minutes=2),
        **common,
    )
    scheduler.add_job(
        weekly_reminder,
        # Triggers built directly default to the machine's local zone, so pass tz.
        CronTrigger(day_of_week="sun", hour=19, minute=0, timezone=tz),
        id="weekly_reminder",
        misfire_grace_time=3 * 60 * 60,
        **common,
    )
    return scheduler
