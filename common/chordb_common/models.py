from datetime import datetime
from enum import StrEnum

from sqlalchemy import BigInteger, DateTime, Enum, String, Text, func, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class NotationKind(StrEnum):
    LETTER = "letter"
    SOLFEGE = "solfege"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True)

    first_name: Mapped[str] = mapped_column(String(255))
    last_name: Mapped[str | None] = mapped_column(String(255))
    username: Mapped[str | None] = mapped_column(String(64))
    language_code: Mapped[str | None] = mapped_column(String(16))
    photo_url: Mapped[str | None] = mapped_column(Text)
    is_premium_tg: Mapped[bool] = mapped_column(server_default=text("false"))

    # Settings
    notation: Mapped[NotationKind | None] = mapped_column(
        Enum(
            NotationKind,
            native_enum=False,
            length=16,
            values_callable=lambda e: [m.value for m in e],
            name="notation_kind",
        )
    )
    notifications_enabled: Mapped[bool] = mapped_column(server_default=text("true"))
    is_blocked_bot: Mapped[bool] = mapped_column(server_default=text("false"))

    # Whether the bot may message the user (from initData / requestWriteAccess).
    allows_write_to_pm: Mapped[bool | None]
    bot_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    write_access_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    tuner_opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    @property
    def can_message(self) -> bool:
        return not self.is_blocked_bot and (
            self.bot_started_at is not None or bool(self.allows_write_to_pm)
        )
