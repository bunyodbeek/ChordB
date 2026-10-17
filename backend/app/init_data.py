"""Telegram Mini App initData validation.

https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
"""

import hashlib
import hmac
import json
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qsl, urlencode

# Tolerated clock skew for auth_date in the future (seconds).
FUTURE_SKEW = 60


class InitDataError(ValueError):
    pass


@dataclass(frozen=True)
class TelegramUser:
    id: int
    first_name: str
    last_name: str | None = None
    username: str | None = None
    language_code: str | None = None
    photo_url: str | None = None
    is_premium: bool = False
    allows_write_to_pm: bool | None = None


@dataclass(frozen=True)
class InitData:
    user: TelegramUser
    auth_date: int
    start_param: str | None = None
    raw: dict[str, str] = field(default_factory=dict, repr=False)


def _secret_key(bot_token: str) -> bytes:
    return hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()


def _data_check_string(fields: dict[str, str]) -> str:
    return "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))


def sign_init_data(fields: dict[str, Any], bot_token: str) -> str:
    """Build a signed initData query string. Used by tests and the dev helper."""
    str_fields = {
        k: v if isinstance(v, str) else json.dumps(v, separators=(",", ":"), ensure_ascii=False)
        for k, v in fields.items()
    }
    digest = hmac.new(
        _secret_key(bot_token), _data_check_string(str_fields).encode(), hashlib.sha256
    ).hexdigest()
    return urlencode({**str_fields, "hash": digest})


def validate_init_data(
    init_data: str,
    bot_token: str,
    *,
    max_age: int = 24 * 60 * 60,
    now: float | None = None,
) -> InitData:
    try:
        pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=True)
    except ValueError as e:
        raise InitDataError("malformed initData") from e

    fields = dict(pairs)
    if len(fields) != len(pairs):
        raise InitDataError("duplicate keys in initData")

    received_hash = fields.pop("hash", None)
    if not received_hash:
        raise InitDataError("missing hash")

    expected = hmac.new(
        _secret_key(bot_token), _data_check_string(fields).encode(), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected, received_hash):
        raise InitDataError("invalid hash")

    try:
        auth_date = int(fields["auth_date"])
    except (KeyError, ValueError) as e:
        raise InitDataError("missing or invalid auth_date") from e

    now = time.time() if now is None else now
    if now - auth_date > max_age:
        raise InitDataError("initData expired")
    if auth_date - now > FUTURE_SKEW:
        raise InitDataError("auth_date is in the future")

    try:
        u = json.loads(fields["user"])
        user = TelegramUser(
            id=int(u["id"]),
            first_name=str(u.get("first_name") or ""),
            last_name=u.get("last_name"),
            username=u.get("username"),
            language_code=u.get("language_code"),
            photo_url=u.get("photo_url"),
            is_premium=bool(u.get("is_premium", False)),
            allows_write_to_pm=u.get("allows_write_to_pm"),
        )
    except (KeyError, ValueError, TypeError) as e:
        raise InitDataError("missing or invalid user") from e

    return InitData(
        user=user, auth_date=auth_date, start_param=fields.get("start_param"), raw=fields
    )
