from sqlalchemy import func, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from chordb_common.models import User


async def upsert_user(
    session: AsyncSession,
    *,
    telegram_id: int,
    first_name: str,
    last_name: str | None = None,
    username: str | None = None,
    language_code: str | None = None,
    photo_url: str | None = None,
    is_premium: bool = False,
    allows_write_to_pm: bool | None = None,
) -> User:
    """Insert the user or refresh their Telegram profile; always bumps last_seen_at.

    photo_url and allows_write_to_pm are only overwritten when a value is given,
    because the bot's view of a user does not include them.
    """
    stmt = insert(User).values(
        telegram_id=telegram_id,
        first_name=first_name,
        last_name=last_name,
        username=username,
        language_code=language_code,
        photo_url=photo_url,
        is_premium_tg=is_premium,
        allows_write_to_pm=allows_write_to_pm,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[User.telegram_id],
        set_={
            "first_name": stmt.excluded.first_name,
            "last_name": stmt.excluded.last_name,
            "username": stmt.excluded.username,
            "language_code": stmt.excluded.language_code,
            "is_premium_tg": stmt.excluded.is_premium_tg,
            "photo_url": func.coalesce(stmt.excluded.photo_url, User.photo_url),
            "allows_write_to_pm": func.coalesce(
                stmt.excluded.allows_write_to_pm, User.allows_write_to_pm
            ),
            "last_seen_at": func.now(),
        },
    ).returning(User)
    user = await session.scalar(stmt, execution_options={"populate_existing": True})
    assert user is not None
    return user


async def mark_bot_started(session: AsyncSession, user_id: int) -> None:
    """User pressed /start: the bot may message them, and they are not blocking it."""
    await session.execute(
        update(User)
        .where(User.id == user_id)
        .values(bot_started_at=func.coalesce(User.bot_started_at, func.now()), is_blocked_bot=False)
    )


async def set_blocked(session: AsyncSession, *, telegram_id: int, blocked: bool) -> None:
    await session.execute(
        update(User).where(User.telegram_id == telegram_id).values(is_blocked_bot=blocked)
    )
