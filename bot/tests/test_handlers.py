"""Feed real Telegram updates through the aiogram Dispatcher with a mocked API session."""

from datetime import UTC, datetime

from aiogram import Bot, Dispatcher
from aiogram.client.session.base import BaseSession
from aiogram.methods import AnswerCallbackQuery, EditMessageReplyMarkup, GetMe, SendMessage
from aiogram.types import (
    CallbackQuery,
    Chat,
    ChatMemberBanned,
    ChatMemberMember,
    ChatMemberUpdated,
    Message,
    MessageEntity,
    Update,
)
from aiogram.types import User as TgUser

from sqlalchemy import select

from chordb_common.models import User
from chordb_common.repo import upsert_user

from chordb_bot import handlers
from chordb_bot.jobs import NOTIFICATIONS_OFF_CB

NOW = datetime.now(UTC)
BOT_USER = TgUser(id=1, is_bot=True, first_name="ChordB", username="chordb_bot")
ALICE = TgUser(id=500, is_bot=False, first_name="Bunyod", language_code="uz")
CHAT = Chat(id=500, type="private")


class MockSession(BaseSession):
    def __init__(self) -> None:
        super().__init__()
        self.requests: list = []

    async def make_request(self, bot, method, timeout=None):
        self.requests.append(method)
        if isinstance(method, GetMe):
            return BOT_USER
        if isinstance(method, SendMessage):
            return Message(message_id=1, date=NOW, chat=CHAT, text=method.text)
        return True

    async def stream_content(self, *a, **kw):  # pragma: no cover
        raise NotImplementedError

    async def close(self) -> None:
        pass


def setup(sessionmaker) -> tuple[Bot, Dispatcher, MockSession]:
    session = MockSession()
    bot = Bot("123456:TEST-token", session=session)
    dp = Dispatcher(sessionmaker=sessionmaker)
    dp.include_router(handlers.router())
    return bot, dp, session


async def get_user(sessionmaker) -> User | None:
    async with sessionmaker() as s:
        return await s.scalar(select(User).where(User.telegram_id == ALICE.id))


async def test_start(sessionmaker) -> None:
    bot, dp, session = setup(sessionmaker)
    msg = Message(
        message_id=10,
        date=NOW,
        chat=CHAT,
        from_user=ALICE,
        text="/start",
        entities=[MessageEntity(type="bot_command", offset=0, length=6)],
    )
    await dp.feed_update(bot, Update(update_id=1, message=msg))

    sent = [r for r in session.requests if isinstance(r, SendMessage)]
    assert len(sent) == 1
    assert "Bunyod" in sent[0].text
    button = sent[0].reply_markup.inline_keyboard[0][0]
    assert button.web_app.url == "https://chordb.test"

    user = await get_user(sessionmaker)
    assert user.first_name == "Bunyod"
    assert user.bot_started_at is not None
    assert user.can_message


async def test_block_and_unblock(sessionmaker) -> None:
    bot, dp, _ = setup(sessionmaker)
    async with sessionmaker() as s:
        await upsert_user(s, telegram_id=ALICE.id, first_name="Bunyod")
        await s.commit()

    def member_update(old, new) -> Update:
        return Update(
            update_id=2,
            my_chat_member=ChatMemberUpdated(
                chat=CHAT, from_user=ALICE, date=NOW, old_chat_member=old, new_chat_member=new
            ),
        )

    member = ChatMemberMember(user=BOT_USER)
    banned = ChatMemberBanned(user=BOT_USER, until_date=0)

    await dp.feed_update(bot, member_update(member, banned))
    assert (await get_user(sessionmaker)).is_blocked_bot is True
    await dp.feed_update(bot, member_update(banned, member))
    assert (await get_user(sessionmaker)).is_blocked_bot is False


async def test_notifications_off_button(sessionmaker) -> None:
    bot, dp, session = setup(sessionmaker)
    async with sessionmaker() as s:
        await upsert_user(s, telegram_id=ALICE.id, first_name="Bunyod")
        await s.commit()

    query = CallbackQuery(
        id="q1",
        from_user=ALICE,
        chat_instance="ci",
        data=NOTIFICATIONS_OFF_CB,
        message=Message(message_id=5, date=NOW, chat=CHAT, text="Haftalik"),
    )
    await dp.feed_update(bot, Update(update_id=3, callback_query=query))

    assert (await get_user(sessionmaker)).notifications_enabled is False
    assert any(isinstance(r, AnswerCallbackQuery) for r in session.requests)
    assert any(isinstance(r, EditMessageReplyMarkup) for r in session.requests)
