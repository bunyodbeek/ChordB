"""Admin helpers for testing notifications by hand.

    uv run python -m chordb_bot.cli send <telegram_id> "Matn"          # one user
    uv run python -m chordb_bot.cli broadcast "Matn" --yes             # all reachable users
    uv run python -m chordb_bot.cli run-job welcome|weekly             # run a scheduled job now
"""

import argparse
import asyncio
import logging

from sqlalchemy import select

from chordb_common.db import get_sessionmaker
from chordb_common.models import User

from chordb_bot import texts
from chordb_bot.jobs import JOBS, messageable
from chordb_bot.main import make_bot
from chordb_bot.notify import Notifier, WebAppButton


async def run(args: argparse.Namespace) -> None:
    bot = make_bot()
    notifier = Notifier(bot, get_sessionmaker())
    button = WebAppButton(texts.OPEN_APP) if args.__dict__.get("button") else None
    try:
        if args.cmd == "send":
            print(await notifier.send_to_user(args.telegram_id, args.text, button))
        elif args.cmd == "broadcast":
            async with notifier.sessionmaker() as s:
                users = (await s.scalars(select(User).where(messageable()))).all()
            if not args.yes:
                print(f"Would send to {len(users)} users. Re-run with --yes.")
                return
            print(dict(await notifier.broadcast(users, args.text, button)))
        elif args.cmd == "run-job":
            print(dict(await JOBS[args.job](notifier)))
    finally:
        await bot.session.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    p = argparse.ArgumentParser(prog="chordb_bot.cli")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("send")
    s.add_argument("telegram_id", type=int)
    s.add_argument("text")
    s.add_argument("--button", action="store_true", help="attach the 'open app' button")
    b = sub.add_parser("broadcast")
    b.add_argument("text")
    b.add_argument("--button", action="store_true")
    b.add_argument("--yes", action="store_true")
    j = sub.add_parser("run-job")
    j.add_argument("job", choices=sorted(JOBS))
    asyncio.run(run(p.parse_args()))


if __name__ == "__main__":
    main()
