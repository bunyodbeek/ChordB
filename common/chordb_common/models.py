import uuid
from datetime import UTC, date, datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, deferred, mapped_column


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
    PRACTICE_REMINDER = "practice_reminder"


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
    # is_premium is premium with no end date, premium_until a paid or granted period.
    # Check has_premium, which is either.
    is_premium: Mapped[bool] = mapped_column(server_default=text("false"))
    premium_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

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
    # IANA zone from the webapp (Intl); practice days and reminders use it. None = NOTIFY_TZ.
    timezone: Mapped[str | None] = mapped_column(String(64))
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
    def has_premium(self) -> bool:
        return self.is_premium or (
            self.premium_until is not None and self.premium_until > datetime.now(UTC)
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
        CheckConstraint("bpm BETWEEN 30 AND 300", name="ck_songs_bpm"),
        CheckConstraint(
            "time_signature IN ('2/4', '3/4', '4/4', '6/8')", name="ck_songs_time_signature"
        ),
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
    # True: `difficulty` follows the chords (chordb_common.difficulty), recomputed whenever
    # the timeline or capo changes; False: the admin picked it.
    difficulty_auto: Mapped[bool] = mapped_column(server_default=text("false"))
    language: Mapped[str] = mapped_column(String(8), server_default=text("'uz'"))
    is_premium: Mapped[bool] = mapped_column(server_default=text("false"))
    is_published: Mapped[bool] = mapped_column(server_default=text("false"))
    duration_sec: Mapped[int] = mapped_column(Integer)
    # The strumming row in the player. None = the default pattern (chordb_common.strum).
    strum_pattern_id: Mapped[int | None] = mapped_column(
        ForeignKey("strum_patterns.id", ondelete="SET NULL")
    )
    # Quarter notes per minute. None = from a finished analysis of the same video.
    bpm: Mapped[float | None] = mapped_column(Float)
    time_signature: Mapped[str] = mapped_column(String(5), server_default=text("'4/4'"))
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
    # A different pattern from here on, e.g. for the chorus. None = the song's.
    strum_pattern_id: Mapped[int | None] = mapped_column(
        ForeignKey("strum_patterns.id", ondelete="SET NULL")
    )


class StrumPattern(Base):
    """One bar of eight eighth notes: D down, U up, - rest, x chuck (chordb_common.strum)."""

    __tablename__ = "strum_patterns"
    __table_args__ = (CheckConstraint("slots ~ '^[DUx-]{8}$'", name="ck_strum_patterns_slots"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(32))
    slots: Mapped[str] = mapped_column(String(8))
    is_premium: Mapped[bool] = mapped_column(server_default=text("false"))
    sort: Mapped[int] = mapped_column(SmallInteger, server_default=text("0"))


class StrumProgress(Base):
    """A user's best accuracy with a pattern at one tempo, in the rhythm trainer."""

    __tablename__ = "strum_progress"
    __table_args__ = (
        CheckConstraint("best_accuracy BETWEEN 0 AND 1", name="ck_strum_progress_accuracy"),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    pattern_id: Mapped[int] = mapped_column(
        ForeignKey("strum_patterns.id", ondelete="CASCADE"), primary_key=True
    )
    bpm: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    best_accuracy: Mapped[float] = mapped_column(Float)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class UserSavedSong(Base):
    """A song the user saved in the player (the list's "Saqlangan" chip)."""

    __tablename__ = "user_saved_songs"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    song_id: Mapped[int] = mapped_column(
        ForeignKey("songs.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


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


class AnalysisSource(StrEnum):
    UPLOAD = "upload"
    YOUTUBE = "youtube"


class AnalysisStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class Analysis(Base):
    """One chord-detection request. Media is never stored: only the result.

    A cache hit is a copy of an earlier result (cache_hit = true), so every user's
    history holds only their own rows.
    """

    __tablename__ = "analyses"
    __table_args__ = (
        Index("ix_analyses_user_created", "user_id", "created_at"),
        Index("ix_analyses_youtube_id", "youtube_id"),
        Index("ix_analyses_file_hash", "file_hash"),
        # The worker's queue scan.
        Index("ix_analyses_queued", "id", postgresql_where=text("status = 'queued'")),
        CheckConstraint("key_root BETWEEN 0 AND 11", name="ck_analyses_key_root"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    source: Mapped[AnalysisSource] = mapped_column(_str_enum(AnalysisSource, "analysis_source"))
    source_ref: Mapped[str] = mapped_column(Text)  # the YouTube URL or the uploaded file's name
    title: Mapped[str | None] = mapped_column(String(255))  # for the history list
    youtube_id: Mapped[str | None] = mapped_column(String(32))
    file_hash: Mapped[str | None] = mapped_column(String(64))  # sha256 of the uploaded bytes
    # Uploaded file waiting for the worker; cleared once it is deleted.
    media_path: Mapped[str | None] = mapped_column(Text)
    status: Mapped[AnalysisStatus] = mapped_column(
        _str_enum(AnalysisStatus, "analysis_status"), server_default=text("'queued'")
    )
    error_code: Mapped[str | None] = mapped_column(String(32))
    cache_hit: Mapped[bool] = mapped_column(server_default=text("false"))

    key_root: Mapped[int | None] = mapped_column(SmallInteger)
    key_quality: Mapped[Quality | None] = mapped_column(_str_enum(Quality, "chord_quality"))
    bpm: Mapped[float | None] = mapped_column(Float)
    duration_sec: Mapped[float | None] = mapped_column(Float)
    beats: Mapped[list | None] = mapped_column(JSONB)  # [sec, …]
    # [{start_sec, end_sec, chord: {root, quality} | null, confidence}]
    events: Mapped[list | None] = mapped_column(JSONB)
    # Sub-semitone deviation from A440 that the engine corrected for.
    tuning_offset_cents: Mapped[float | None] = mapped_column(Float)
    # {"name": "Eb standard", "shift": -1} when the song was most likely played in a
    # down-tuning; shapes there are each chord moved up by -shift semitones.
    alt_tuning: Mapped[dict | None] = mapped_column(JSONB)
    suggested_capo: Mapped[int | None] = mapped_column(SmallInteger)  # standard tuning
    engine_version: Mapped[str | None] = mapped_column(String(16))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


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


class PaymentStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class Payment(Base):
    """A manual payment: the user pays by card and uploads the receipt; an admin decides."""

    __tablename__ = "payments"
    __table_args__ = (
        Index("ix_payments_user_created", "user_id", "created_at"),
        # At most one request waiting per user.
        Index(
            "ux_payments_one_pending",
            "user_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    plan: Mapped[str] = mapped_column(String(16))  # a key of chordb_common.premium.PLANS
    days: Mapped[int] = mapped_column(Integer)
    amount: Mapped[int] = mapped_column(Integer)  # soʻm
    # The receipt image (a screenshot, usually well under 1 MB); loaded only when asked for.
    receipt: Mapped[bytes] = deferred(mapped_column(LargeBinary))
    receipt_type: Mapped[str] = mapped_column(String(32))
    status: Mapped[PaymentStatus] = mapped_column(
        _str_enum(PaymentStatus, "payment_status"), server_default=text("'pending'")
    )
    note: Mapped[str | None] = mapped_column(Text)  # the admin's; sent to the user on reject
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class PremiumEventKind(StrEnum):
    GRANTED = "granted"  # by an admin, without a payment
    PAID = "paid"  # a payment was approved
    REJECTED = "rejected"  # a payment was rejected
    REVOKED = "revoked"


class PremiumEvent(Base):
    """A user's premium history, for the admin panel."""

    __tablename__ = "premium_events"
    __table_args__ = (Index("ix_premium_events_user", "user_id", "created_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[PremiumEventKind] = mapped_column(_str_enum(PremiumEventKind, "premium_event"))
    days: Mapped[int | None] = mapped_column(Integer)  # None on granted = no end date
    payment_id: Mapped[int | None] = mapped_column(ForeignKey("payments.id", ondelete="SET NULL"))
    admin_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class UserEventType(StrEnum):
    APP_OPENED = "app_opened"
    TUNER_OPENED = "tuner_opened"
    SONG_OPENED = "song_opened"  # ref = song id (empty on rows before the Asosiy page)
    PREMIUM_VIEWED = "premium_viewed"
    DEEP_LINK = "deep_link"  # opened through t.me/<bot>/<app>?startapp=song_<id>; ref = song id
    PRACTICE_STEP = "practice_step"  # ref = the step
    GAME_START = "game_start"  # ref = the game
    GAME_FINISH = "game_finish"  # ref = the game
    CHORD_UNLOCK = "chord_unlock"  # ref = the chord, e.g. "Am"


class UserEvent(Base):
    """Activity and funnel steps: at most one row per user, type, day and ref."""

    __tablename__ = "user_events"
    __table_args__ = (
        UniqueConstraint("user_id", "type", "day", "ref", name="uq_user_events_daily"),
        Index("ix_user_events_type_day", "type", "day"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    type: Mapped[UserEventType] = mapped_column(_str_enum(UserEventType, "user_event_type"))
    day: Mapped[date] = mapped_column(Date)  # in NOTIFY_TZ
    ref: Mapped[str] = mapped_column(String(32), server_default=text("''"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class SearchMiss(Base):
    """A song search that found nothing: ideas for the catalog."""

    __tablename__ = "search_misses"
    __table_args__ = (Index("ix_search_misses_created", "created_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    query: Mapped[str] = mapped_column(String(100))  # trimmed, lower case
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class PracticeStep(StrEnum):
    TUNE = "tune"
    CHORD_SWITCH = "chord_switch"
    EAR_TEST = "ear_test"


class Game(StrEnum):
    CHORD_SWITCH = "chord_switch"
    EAR_TEST = "ear_test"


class PracticeDay(Base):
    """One calendar day (in the user's zone) of the daily practice: tune, switch, ear test."""

    __tablename__ = "practice_days"
    __table_args__ = (UniqueConstraint("user_id", "date", name="uq_practice_days_user_date"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    date: Mapped[date] = mapped_column(Date)
    steps_done: Mapped[list] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))  # [step, …]
    completed: Mapped[bool] = mapped_column(server_default=text("false"))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Streak(Base):
    __tablename__ = "streaks"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    current: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    best: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    last_practice_date: Mapped[date | None] = mapped_column(Date)
    freezes_left: Mapped[int] = mapped_column(SmallInteger, server_default=text("0"))
    # First day of the month freezes_left was last refilled for.
    freezes_month: Mapped[date | None] = mapped_column(Date)


class GameResult(Base):
    __tablename__ = "game_results"
    __table_args__ = (Index("ix_game_results_user_created", "user_id", "created_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    game: Mapped[Game] = mapped_column(_str_enum(Game, "game"))
    score: Mapped[int] = mapped_column(Integer)
    details: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class PersonalBest(Base):
    __tablename__ = "personal_bests"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    game: Mapped[Game] = mapped_column(_str_enum(Game, "game"), primary_key=True)
    # chord_switch: the chain ("Am-C-G-F"); ear_test: the level ("level1").
    chain_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class UnlockMode(StrEnum):
    PLAYED = "played"  # recognised through the mic
    LISTENED = "listened"  # no mic: heard and confirmed by the user


class ChordCollection(Base):
    __tablename__ = "chord_collection"
    __table_args__ = (
        UniqueConstraint("user_id", "root", "quality", name="uq_chord_collection_chord"),
        CheckConstraint("root BETWEEN 0 AND 11", name="ck_chord_collection_root"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    root: Mapped[int] = mapped_column(SmallInteger)
    quality: Mapped[Quality] = mapped_column(_str_enum(Quality, "chord_quality"))
    mode: Mapped[UnlockMode] = mapped_column(_str_enum(UnlockMode, "unlock_mode"))
    unlocked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class EarProgress(Base):
    """How far a user got in the ear-test levels (chordb_common.ear)."""

    __tablename__ = "ear_progress"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    max_unlocked_level: Mapped[int] = mapped_column(SmallInteger, server_default=text("1"))
    # {"1": 10, "2": 9, …}: the best score of each level played.
    best_score_per_level: Mapped[dict] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    perfect_streak: Mapped[int] = mapped_column(Integer, server_default=text("0"))  # 10/10 runs in a row
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class EarRunStatus(StrEnum):
    ACTIVE = "active"
    FINISHED = "finished"
    EXPIRED = "expired"  # not finished in time, or replaced by a newer run


class EarRun(Base):
    """Ten ear-test questions. The answers stay here: the webapp never sees them."""

    __tablename__ = "ear_runs"
    __table_args__ = (Index("ix_ear_runs_user_status", "user_id", "status"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    level: Mapped[int] = mapped_column(SmallInteger)
    # [{"chords": [[root, quality], …], "answer": option id, "options": [option id, …]}]
    questions: Mapped[list] = mapped_column(JSONB)
    # [{"question_id": i, "choice": option id, "correct": bool}], in question order
    answers: Mapped[list] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    score: Mapped[int | None] = mapped_column(SmallInteger)  # set when finished
    status: Mapped[EarRunStatus] = mapped_column(
        _str_enum(EarRunStatus, "ear_run_status"), server_default=text("'active'")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SongKind(StrEnum):
    SONG = "song"  # a catalog song (songs.id)
    ANALYSIS = "analysis"  # the user's own analysed song (analyses.id)


class UserSongSettings(Base):
    """How a user plays a song in the player: capo, transposition, simplified chords."""

    __tablename__ = "user_song_settings"
    __table_args__ = (
        CheckConstraint("capo BETWEEN 0 AND 12", name="ck_user_song_settings_capo"),
        CheckConstraint("shift BETWEEN -11 AND 11", name="ck_user_song_settings_shift"),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    kind: Mapped[SongKind] = mapped_column(_str_enum(SongKind, "song_kind"), primary_key=True)
    ref_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    capo: Mapped[int] = mapped_column(SmallInteger)
    shift: Mapped[int] = mapped_column(SmallInteger, server_default=text("0"))
    simple: Mapped[bool] = mapped_column(server_default=text("false"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class SongEventOverride(Base):
    """A user's fix of one chord of their own analysis. Analysis.events stays as the
    engine found it: cache hits copy it to other users."""

    __tablename__ = "song_event_overrides"
    __table_args__ = (CheckConstraint("root BETWEEN 0 AND 11", name="ck_song_event_overrides_root"),)

    analysis_id: Mapped[int] = mapped_column(
        ForeignKey("analyses.id", ondelete="CASCADE"), primary_key=True
    )
    event_index: Mapped[int] = mapped_column(Integer, primary_key=True)  # into Analysis.events
    root: Mapped[int] = mapped_column(SmallInteger)
    quality: Mapped[Quality] = mapped_column(_str_enum(Quality, "chord_quality"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class SuggestionStatus(StrEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"


class ChordSuggestion(Base):
    """A user's correction of a catalog song's chord, for an admin to accept or reject."""

    __tablename__ = "chord_suggestions"
    __table_args__ = (
        Index("ix_chord_suggestions_user_created", "user_id", "created_at"),
        Index("ix_chord_suggestions_status", "status", "created_at"),
        CheckConstraint("root BETWEEN 0 AND 11", name="ck_chord_suggestions_root"),
        CheckConstraint("old_root BETWEEN 0 AND 11", name="ck_chord_suggestions_old_root"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    song_id: Mapped[int] = mapped_column(ForeignKey("songs.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    event_ids: Mapped[list] = mapped_column(JSONB)  # [chord_events.id, …]
    # What the first of those events had when suggested, for the admin's list.
    old_root: Mapped[int] = mapped_column(SmallInteger)
    old_quality: Mapped[Quality] = mapped_column(_str_enum(Quality, "chord_quality"))
    root: Mapped[int] = mapped_column(SmallInteger)
    quality: Mapped[Quality] = mapped_column(_str_enum(Quality, "chord_quality"))
    status: Mapped[SuggestionStatus] = mapped_column(
        _str_enum(SuggestionStatus, "suggestion_status"), server_default=text("'pending'")
    )
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
