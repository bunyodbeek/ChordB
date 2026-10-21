import tempfile
from functools import lru_cache
from pathlib import Path
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

    # Time zone for scheduled notifications.
    notify_tz: str = "Asia/Tashkent"

    # Comma-separated Telegram user ids allowed to use /api/admin, e.g. "123,456".
    admin_ids: str = ""

    # Chord detection (/api/analyze and the worker).
    # Uploaded media waits here until the worker has analysed it, then it is deleted.
    # The API and the worker must see the same directory.
    media_dir: str = ""  # default: <system temp>/chordb-media
    analyze_free_per_day: int = 3  # premium users and admins are unlimited; cache hits are free
    analyze_max_upload_mb: int = 50
    analyze_concurrency: int = 2
    analyze_timeout_sec: int = 180

    # Premium is paid by card transfer; the user uploads the receipt and an admin approves.
    payment_card: str = ""  # shown to the user, e.g. "8600 1234 5678 9012"
    payment_card_holder: str = ""
    premium_price_month: int = 20_000  # soʻm, 30 days
    premium_price_year: int = 150_000  # soʻm, 365 days

    # For song links like t.me/<bot_username>/<webapp_short_name>?startapp=song_12.
    # Without a short name the link opens the bot's main Mini App.
    bot_username: str = ""
    webapp_short_name: str = ""

    @property
    def media_path(self) -> Path:
        return Path(self.media_dir) if self.media_dir else Path(tempfile.gettempdir()) / "chordb-media"

    @property
    def admin_id_set(self) -> frozenset[int]:
        return frozenset(int(x) for x in self.admin_ids.replace(" ", "").split(",") if x)

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
