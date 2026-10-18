import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import BotCommand, MenuButtonWebApp, WebAppInfo

from chordb_common.config import get_settings
from chordb_common.db import get_sessionmaker

from chordb_bot import handlers, texts
from chordb_bot.jobs import make_scheduler
from chordb_bot.notify import Notifier

log = logging.getLogger("chordb_bot")


def make_bot() -> Bot:
    return Bot(get_settings().bot_token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))


async def setup_bot_ui(bot: Bot) -> None:
    url = get_settings().webapp_url
    await bot.set_my_commands([BotCommand(command="start", description="Tyunerni ochish")])
    if url.startswith("https://"):
        await bot.set_chat_menu_button(
            menu_button=MenuButtonWebApp(text=texts.MENU_BUTTON, web_app=WebAppInfo(url=url))
        )
        log.info("menu button -> %s", url)
    else:
        log.warning("WEBAPP_URL must be https:// to set the menu button (got %r)", url)


async def main() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    bot = make_bot()
    sessionmaker = get_sessionmaker()
    notifier = Notifier(bot, sessionmaker)

    dp = Dispatcher(sessionmaker=sessionmaker, notifier=notifier)
    dp.include_router(handlers.router())

    await setup_bot_ui(bot)
    scheduler = make_scheduler(notifier)
    scheduler.start()
    try:
        await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())
    finally:
        scheduler.shutdown(wait=False)
        await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
