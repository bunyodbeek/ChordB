from aiogram import F, Router
from aiogram.filters import Command
from aiogram.types import Message

from chordb_common.config import get_settings

from chordb_bot import texts
from chordb_bot.notify import WebAppButton, web_app_markup


def admin_panel_url() -> str:
    return get_settings().webapp_url.rstrip("/") + "/admin"


async def cmd_admin(message: Message) -> None:
    """Opens the admin panel; best on Telegram Desktop, where it gets a big window."""
    await message.answer(
        texts.ADMIN_PANEL,
        reply_markup=web_app_markup(WebAppButton(texts.ADMIN_PANEL_BUTTON, admin_panel_url())),
    )


def make_router() -> Router:
    router = Router(name="admin")
    router.message.filter(
        F.chat.type == "private", F.from_user.id.in_(get_settings().admin_id_set)
    )
    router.message.register(cmd_admin, Command("admin"))
    return router
