"""Sending notifications: rate limiting, 403/429 handling and logging to `notifications`."""

import asyncio
import logging
from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import dataclass

from aiogram import Bot
from aiogram.exceptions import TelegramAPIError, TelegramForbiddenError, TelegramRetryAfter
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from chordb_common.config import get_settings
from chordb_common.models import Notification, NotificationStatus, NotificationType, User
from chordb_common.repo import set_blocked

log = logging.getLogger(__name__)

# Telegram allows ~30 msg/s to different chats; stay below it.
DEFAULT_RATE = 25.0


@dataclass(frozen=True)
class WebAppButton:
    text: str
    url: str | None = None  # defaults to WEBAPP_URL


Button = WebAppButton | InlineKeyboardMarkup | None


def web_app_markup(button: WebAppButton) -> InlineKeyboardMarkup:
    url = button.url or get_settings().webapp_url
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text=button.text, web_app=WebAppInfo(url=url))]]
    )


def _markup(button: Button) -> InlineKeyboardMarkup | None:
    return web_app_markup(button) if isinstance(button, WebAppButton) else button


class RateLimiter:
    """Spaces calls evenly at `rate` per second across all concurrent senders."""

    def __init__(self, rate: float) -> None:
        self._interval = 1.0 / rate
        self._next = 0.0
        self._lock = asyncio.Lock()

    async def wait(self) -> None:
        async with self._lock:
            loop = asyncio.get_running_loop()
            now = loop.time()
            if self._next > now:
                await asyncio.sleep(self._next - now)
                now = self._next
            self._next = now + self._interval

    def pause(self, seconds: float) -> None:
        """Hold every sender back, e.g. after a 429 flood-wait."""
        self._next = max(self._next, asyncio.get_running_loop().time() + seconds)


class Notifier:
    def __init__(
        self,
        bot: Bot,
        sessionmaker: async_sessionmaker[AsyncSession],
        *,
        rate: float = DEFAULT_RATE,
        concurrency: int = 8,
    ) -> None:
        self.bot = bot
        self.sessionmaker = sessionmaker
        self.limiter = RateLimiter(rate)
        self.concurrency = concurrency

    async def send_to_user(
        self,
        telegram_id: int,
        text: str,
        button: Button = None,
        *,
        type: NotificationType = NotificationType.DIRECT,
    ) -> NotificationStatus:
        async with self.sessionmaker() as session:
            user = await session.scalar(select(User).where(User.telegram_id == telegram_id))
        if user is None:
            log.warning("send_to_user: unknown telegram_id %s", telegram_id)
            return NotificationStatus.FAILED
        return await self._send(user, text, _markup(button), type)

    async def broadcast(
        self,
        users: Iterable[User],
        text: str | Callable[[User], str],
        button: Button = None,
        *,
        type: NotificationType = NotificationType.BROADCAST,
    ) -> Counter[NotificationStatus]:
        """Send to many users at <= `rate` msg/s. Returns a count per status."""
        markup = _markup(button)
        sem = asyncio.Semaphore(self.concurrency)

        async def one(user: User) -> NotificationStatus:
            async with sem:
                body = text(user) if callable(text) else text
                return await self._send(user, body, markup, type)

        results = await asyncio.gather(*(one(u) for u in users))
        counts = Counter(results)
        log.info("broadcast %s: %s", type, dict(counts))
        return counts

    async def _send(
        self,
        user: User,
        text: str,
        markup: InlineKeyboardMarkup | None,
        type: NotificationType,
    ) -> NotificationStatus:
        status, message_id, error = await self._deliver(user.telegram_id, text, markup)
        async with self.sessionmaker() as session:
            session.add(
                Notification(
                    user_id=user.id,
                    type=type,
                    status=status,
                    telegram_message_id=message_id,
                    error=error,
                )
            )
            if status == NotificationStatus.BLOCKED:
                await set_blocked(session, telegram_id=user.telegram_id, blocked=True)
            await session.commit()
        return status

    async def _deliver(
        self, chat_id: int, text: str, markup: InlineKeyboardMarkup | None
    ) -> tuple[NotificationStatus, int | None, str | None]:
        error = None
        for _ in range(3):
            await self.limiter.wait()
            try:
                msg = await self.bot.send_message(chat_id, text, reply_markup=markup)
                return NotificationStatus.SENT, msg.message_id, None
            except TelegramRetryAfter as e:
                log.warning("flood wait %ss", e.retry_after)
                self.limiter.pause(e.retry_after)
                error = e.message
            except TelegramForbiddenError as e:
                return NotificationStatus.BLOCKED, None, e.message
            except TelegramAPIError as e:
                log.warning("send to %s failed: %s", chat_id, e)
                return NotificationStatus.FAILED, None, e.message
        return NotificationStatus.FAILED, None, error
