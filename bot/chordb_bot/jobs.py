"""Scheduled notifications (APScheduler, running inside the bot process)."""

import logging
from collections import Counter
from datetime import UTC, datetime, timedelta

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import ColumnElement, and_, exists, or_, select

from chordb_common.config import get_settings
from chordb_common.models import Notification, NotificationStatus, NotificationType, User

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


JOBS = {"welcome": welcome_followup, "weekly": weekly_reminder}


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
        weekly_reminder,
        # Triggers built directly default to the machine's local zone, so pass tz.
        CronTrigger(day_of_week="sun", hour=19, minute=0, timezone=tz),
        id="weekly_reminder",
        misfire_grace_time=3 * 60 * 60,
        **common,
    )
    return scheduler
