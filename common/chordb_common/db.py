from functools import lru_cache

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from chordb_common.config import get_settings


def make_engine(url: str, **kwargs) -> AsyncEngine:
    return create_async_engine(url, pool_pre_ping=True, **kwargs)


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


@lru_cache
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    return make_sessionmaker(make_engine(get_settings().database_url))
