"""Print a correctly signed initData string for local testing outside Telegram.

    uv run python -m app.dev_init_data --id 1001 --first-name Bunyod

Paste the output into webapp/.env.local as VITE_DEV_INIT_DATA, or use it with curl:
    curl -H "Authorization: tma $(uv run python -m app.dev_init_data)" localhost:8001/api/me
Signing needs the real BOT_TOKEN, so this never bypasses validation. Disabled when ENV=prod.
"""

import argparse
import sys
import time

from chordb_common.config import get_settings

from app.init_data import sign_init_data


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--id", type=int, default=1001)
    p.add_argument("--first-name", default="Test")
    p.add_argument("--username", default="test_user")
    p.add_argument("--language-code", default="uz")
    args = p.parse_args()

    settings = get_settings()
    if settings.env == "prod":
        sys.exit("refusing to run with ENV=prod")

    user = {
        "id": args.id,
        "first_name": args.first_name,
        "username": args.username,
        "language_code": args.language_code,
        "allows_write_to_pm": False,
    }
    print(sign_init_data({"user": user, "auth_date": str(int(time.time()))}, settings.bot_token))


if __name__ == "__main__":
    main()
