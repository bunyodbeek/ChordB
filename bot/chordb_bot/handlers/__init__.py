from aiogram import Router

from chordb_bot.handlers import start


def router() -> Router:
    r = Router()
    r.include_router(start.make_router())
    return r
