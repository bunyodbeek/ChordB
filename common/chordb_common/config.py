from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Looks for .env in the current dir and one level up, so it works from the
    # repo root as well as from backend/ or bot/.
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    bot_token: str
    database_url: str
    webapp_url: str = ""
    env: Literal["dev", "prod"] = "dev"

    # initData older than this is rejected (seconds).
    init_data_max_age: int = 24 * 60 * 60

    @field_validator("database_url")
    @classmethod
    def _use_asyncpg(cls, v: str) -> str:
        # Accept plain postgres URLs and switch them to the async driver.
        for prefix in ("postgres://", "postgresql://"):
            if v.startswith(prefix):
                return "postgresql+asyncpg://" + v[len(prefix):]
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
