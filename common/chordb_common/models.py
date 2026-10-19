from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def _str_enum(enum: type[StrEnum], name: str) -> Enum:
    # Stored as VARCHAR + CHECK rather than a native PG enum: easier to extend.
    return Enum(
        enum,
        native_enum=False,
        length=32,
        values_callable=lambda e: [m.value for m in e],
        name=name,
    )


class NotationKind(StrEnum):
    LETTER = "letter"
    SOLFEGE = "solfege"


class Quality(StrEnum):
    """Chord quality. Rendered as text only by notation.py."""

    MAJOR = "maj"
    MINOR = "min"
    DOM7 = "7"
    MAJ7 = "maj7"
    MIN7 = "m7"
    DIM = "dim"
    AUG = "aug"
    SUS2 = "sus2"
    SUS4 = "sus4"


class Difficulty(StrEnum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


class NotificationType(StrEnum):
    WELCOME_FOLLOWUP = "welcome_followup"
    WEEKLY_REMINDER = "weekly_reminder"
    DIRECT = "direct"
    BROADCAST = "broadcast"


class NotificationStatus(StrEnum):
    SENT = "sent"
    BLOCKED = "blocked"  # 403: user blocked the bot
    FAILED = "failed"


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
    # ChordB's own premium (unlocks premium songs); unrelated to Telegram Premium.
    is_premium: Mapped[bool] = mapped_column(server_default=text("false"))

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


class Song(Base):
    __tablename__ = "songs"
    __table_args__ = (
        CheckConstraint("key_root BETWEEN 0 AND 11", name="ck_songs_key_root"),
        CheckConstraint("capo BETWEEN 0 AND 12", name="ck_songs_capo"),
        CheckConstraint("duration_sec > 0", name="ck_songs_duration"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    title: Mapped[str] = mapped_column(String(255))
    artist: Mapped[str] = mapped_column(String(255))
    youtube_id: Mapped[str] = mapped_column(String(32))
    # Key as a canonical chord: root pitch class + maj/min.
    key_root: Mapped[int] = mapped_column(SmallInteger)
    key_quality: Mapped[Quality] = mapped_column(_str_enum(Quality, "chord_quality"))
    capo: Mapped[int] = mapped_column(SmallInteger, server_default=text("0"))
    difficulty: Mapped[Difficulty] = mapped_column(_str_enum(Difficulty, "difficulty"))
    language: Mapped[str] = mapped_column(String(8), server_default=text("'uz'"))
    is_premium: Mapped[bool] = mapped_column(server_default=text("false"))
    is_published: Mapped[bool] = mapped_column(server_default=text("false"))
    duration_sec: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class SongSection(Base):
    __tablename__ = "song_sections"
    __table_args__ = (UniqueConstraint("song_id", "order", name="uq_song_sections_order"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    song_id: Mapped[int] = mapped_column(ForeignKey("songs.id", ondelete="CASCADE"))
    order: Mapped[int] = mapped_column(SmallInteger)
    title: Mapped[str] = mapped_column(String(64))  # "Kirish", "Kuplet", "Naqarot", …
    start_sec: Mapped[float] = mapped_column(Float)


class ChordEvent(Base):
    """The chord that starts sounding at time_sec in the song's video."""

    __tablename__ = "chord_events"
    __table_args__ = (
        Index("ix_chord_events_song_time", "song_id", "time_sec"),
        CheckConstraint("root BETWEEN 0 AND 11", name="ck_chord_events_root"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    song_id: Mapped[int] = mapped_column(ForeignKey("songs.id", ondelete="CASCADE"))
    section_id: Mapped[int | None] = mapped_column(
        ForeignKey("song_sections.id", ondelete="CASCADE")
    )
    time_sec: Mapped[float] = mapped_column(Float)
    root: Mapped[int] = mapped_column(SmallInteger)
    quality: Mapped[Quality] = mapped_column(_str_enum(Quality, "chord_quality"))


class UserSongProgress(Base):
    """Where a user stopped in a song; the newest row is "continue playing"."""

    __tablename__ = "user_song_progress"
    __table_args__ = (Index("ix_user_song_progress_recent", "user_id", "updated_at"),)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    song_id: Mapped[int] = mapped_column(
        ForeignKey("songs.id", ondelete="CASCADE"), primary_key=True
    )
    position_sec: Mapped[float] = mapped_column(Float)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_type", "user_id", "type"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    type: Mapped[NotificationType] = mapped_column(_str_enum(NotificationType, "notification_type"))
    status: Mapped[NotificationStatus] = mapped_column(
        _str_enum(NotificationStatus, "notification_status")
    )
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    telegram_message_id: Mapped[int | None] = mapped_column(BigInteger)
    error: Mapped[str | None] = mapped_column(Text)
