from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from chordb_common.config import get_settings
from chordb_common.db import get_sessionmaker
from chordb_common.models import User
from chordb_common.repo import upsert_user

from app.init_data import InitDataError, validate_init_data


async def get_session() -> AsyncIterator[AsyncSession]:
    async with get_sessionmaker()() as session:
        yield session


Session = Annotated[AsyncSession, Depends(get_session)]


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "tma"},
    )


async def current_user(
    session: Session,
    authorization: Annotated[str | None, Header()] = None,
) -> User:
    """Validate `Authorization: tma <initData>` and upsert the user."""
    if not authorization:
        raise _unauthorized("missing Authorization header")
    scheme, _, raw = authorization.partition(" ")
    if scheme.lower() != "tma" or not raw:
        raise _unauthorized("expected 'tma <initData>'")

    settings = get_settings()
    try:
        data = validate_init_data(
            raw.strip(), settings.bot_token, max_age=settings.init_data_max_age
        )
    except InitDataError as e:
        raise _unauthorized(str(e)) from e

    u = data.user
    user = await upsert_user(
        session,
        telegram_id=u.id,
        first_name=u.first_name,
        last_name=u.last_name,
        username=u.username,
        language_code=u.language_code,
        photo_url=u.photo_url,
        is_premium=u.is_premium,
        allows_write_to_pm=u.allows_write_to_pm,
    )
    await session.commit()
    return user


CurrentUser = Annotated[User, Depends(current_user)]
