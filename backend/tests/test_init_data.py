import time
from urllib.parse import parse_qsl, urlencode

import pytest

from app.init_data import InitDataError, sign_init_data, validate_init_data

TOKEN = "123456:TEST-token"
USER = {"id": 42, "first_name": "Bunyod", "username": "bunyod", "language_code": "uz"}


def _signed(auth_date: int | None = None, **extra) -> str:
    fields = {"user": USER, "auth_date": str(auth_date or int(time.time())), **extra}
    return sign_init_data(fields, TOKEN)


def _replace(init_data: str, key: str, value: str) -> str:
    fields = dict(parse_qsl(init_data))
    fields[key] = value
    return urlencode(fields)


def test_valid() -> None:
    data = validate_init_data(_signed(query_id="AAE", start_param="x"), TOKEN)
    assert data.user.id == 42
    assert data.user.first_name == "Bunyod"
    assert data.user.language_code == "uz"
    assert data.start_param == "x"


def test_known_vector() -> None:
    # Computed independently: hex(HMAC(HMAC("WebAppData", token), "auth_date=1700000000\nuser={...}"))
    import hashlib
    import hmac

    check = 'auth_date=1700000000\nuser={"id":1,"first_name":"A"}'
    secret = hmac.new(b"WebAppData", TOKEN.encode(), hashlib.sha256).digest()
    h = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    raw = urlencode({"auth_date": "1700000000", "user": '{"id":1,"first_name":"A"}', "hash": h})
    data = validate_init_data(raw, TOKEN, now=1700000000 + 10)
    assert data.user.id == 1


def test_tampered_user() -> None:
    tampered = _replace(_signed(), "user", '{"id":1,"first_name":"Hacker"}')
    with pytest.raises(InitDataError, match="invalid hash"):
        validate_init_data(tampered, TOKEN)


def test_tampered_auth_date() -> None:
    tampered = _replace(_signed(), "auth_date", str(int(time.time()) - 5))
    with pytest.raises(InitDataError, match="invalid hash"):
        validate_init_data(tampered, TOKEN)


def test_wrong_bot_token() -> None:
    with pytest.raises(InitDataError, match="invalid hash"):
        validate_init_data(_signed(), "999:other")


def test_expired() -> None:
    old = int(time.time()) - 24 * 60 * 60 - 1
    with pytest.raises(InitDataError, match="expired"):
        validate_init_data(_signed(auth_date=old), TOKEN)


def test_just_inside_window() -> None:
    now = time.time()
    validate_init_data(_signed(auth_date=int(now) - 24 * 60 * 60 + 5), TOKEN, now=now)


def test_future_auth_date() -> None:
    future = int(time.time()) + 3600
    with pytest.raises(InitDataError, match="future"):
        validate_init_data(_signed(auth_date=future), TOKEN)


def test_missing_hash() -> None:
    raw = urlencode({"user": '{"id":1}', "auth_date": str(int(time.time()))})
    with pytest.raises(InitDataError, match="missing hash"):
        validate_init_data(raw, TOKEN)


def test_duplicate_keys() -> None:
    with pytest.raises(InitDataError):
        validate_init_data(_signed() + "&auth_date=1", TOKEN)


def test_garbage() -> None:
    with pytest.raises(InitDataError):
        validate_init_data("not a query string", TOKEN)
