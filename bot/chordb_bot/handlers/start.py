from aiogram import F, Router
from aiogram.filters import KICKED, MEMBER, ChatMemberUpdatedFilter, CommandStart
from aiogram.types import (
    CallbackQuery,
    ChatMemberUpdated,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from chordb_common.models import User
from chordb_common.repo import mark_bot_started, set_blocked, upsert_user

from chordb_bot import texts
from chordb_bot.jobs import NOTIFICATIONS_OFF_CB, NOTIFICATIONS_ON_CB
from chordb_bot.notify import WebAppButton, web_app_markup


async def cmd_start(message: Message, sessionmaker: async_sessionmaker[AsyncSession]) -> None:
    tg = message.from_user
    assert tg is not None
    async with sessionmaker() as session:
        user = await upsert_user(
            session,
            telegram_id=tg.id,
            first_name=tg.first_name,
            last_name=tg.last_name,
            username=tg.username,
            language_code=tg.language_code,
            is_premium=bool(tg.is_premium),
        )
        await mark_bot_started(session, user.id)
        await session.commit()

    await message.answer(
        texts.greeting(tg.first_name), reply_markup=web_app_markup(WebAppButton(texts.OPEN_APP))
    )


async def on_blocked(event: ChatMemberUpdated, sessionmaker: async_sessionmaker) -> None:
    async with sessionmaker() as session:
        await set_blocked(session, telegram_id=event.from_user.id, blocked=True)
        await session.commit()


async def on_unblocked(event: ChatMemberUpdated, sessionmaker: async_sessionmaker) -> None:
    async with sessionmaker() as session:
        await set_blocked(session, telegram_id=event.from_user.id, blocked=False)
        await session.commit()


async def _set_notifications(telegram_id: int, enabled: bool, sessionmaker) -> None:
    async with sessionmaker() as session:
        await session.execute(
            update(User).where(User.telegram_id == telegram_id).values(
                notifications_enabled=enabled
            )
        )
        await session.commit()


async def notifications_off(query: CallbackQuery, sessionmaker: async_sessionmaker) -> None:
    await _set_notifications(query.from_user.id, False, sessionmaker)
    await query.answer(texts.NOTIFICATIONS_OFF, show_alert=False)
    if isinstance(query.message, Message):
        await query.message.edit_reply_markup(
            reply_markup=InlineKeyboardMarkup(
                inline_keyboard=[
                    [
                        InlineKeyboardButton(
                            text=texts.NOTIFICATIONS_ON_BUTTON, callback_data=NOTIFICATIONS_ON_CB
                        )
                    ]
                ]
            )
        )


async def notifications_on(query: CallbackQuery, sessionmaker: async_sessionmaker) -> None:
    await _set_notifications(query.from_user.id, True, sessionmaker)
    await query.answer(texts.NOTIFICATIONS_ON)
    if isinstance(query.message, Message):
        await query.message.edit_reply_markup(reply_markup=None)


def make_router() -> Router:
    router = Router(name="start")
    router.message.filter(F.chat.type == "private")
    router.my_chat_member.filter(F.chat.type == "private")

    router.message.register(cmd_start, CommandStart())
    router.my_chat_member.register(
        on_blocked, ChatMemberUpdatedFilter(member_status_changed=KICKED)
    )
    router.my_chat_member.register(
        on_unblocked, ChatMemberUpdatedFilter(member_status_changed=MEMBER)
    )
    router.callback_query.register(notifications_off, F.data == NOTIFICATIONS_OFF_CB)
    router.callback_query.register(notifications_on, F.data == NOTIFICATIONS_ON_CB)
    return router
