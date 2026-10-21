import re
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from chordb_common.config import get_settings
from chordb_common.practice import is_valid_zone
from chordb_common.models import (
    Analysis,
    AnalysisSource,
    AnalysisStatus,
    Difficulty,
    Game,
    NotationKind,
    Payment,
    PaymentStatus,
    PracticeStep,
    PremiumEventKind,
    Quality,
    Song,
    UnlockMode,
    User,
)


class SettingsOut(BaseModel):
    notation: NotationKind | None
    notifications_enabled: bool
    timezone: str | None


class MeOut(BaseModel):
    id: int
    telegram_id: int
    first_name: str
    last_name: str | None
    username: str | None
    language_code: str | None
    photo_url: str | None
    is_premium_tg: bool
    created_at: datetime
    settings: SettingsOut
    # True when the webapp should call WebApp.requestWriteAccess() (once).
    needs_write_access: bool
    is_premium: bool  # ChordB premium: unlocks premium songs
    premium_until: datetime | None  # None with is_premium = no end date
    is_admin: bool  # may use /api/admin (ADMIN_IDS)
    # Song from a t.me/...?startapp=song_<id> link, to open first.
    start_song_id: int | None = None
    # Tab from a t.me/...?startapp=practice link (the practice reminder).
    start_tab: Literal["practice"] | None = None

    @classmethod
    def from_user(cls, u: User) -> "MeOut":
        return cls(
            id=u.id,
            telegram_id=u.telegram_id,
            first_name=u.first_name,
            last_name=u.last_name,
            username=u.username,
            language_code=u.language_code,
            photo_url=u.photo_url,
            is_premium_tg=u.is_premium_tg,
            created_at=u.created_at,
            settings=SettingsOut(
                notation=u.notation,
                notifications_enabled=u.notifications_enabled,
                timezone=u.timezone,
            ),
            needs_write_access=(
                not u.can_message
                and not u.is_blocked_bot
                and u.write_access_requested_at is None
            ),
            is_premium=u.has_premium,
            premium_until=None if u.is_premium else u.premium_until,
            is_admin=is_admin(u),
        )


def is_admin(u: User) -> bool:
    return u.telegram_id in get_settings().admin_id_set


class SettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    notation: NotationKind | None = None
    notifications_enabled: bool | None = None
    timezone: str | None = Field(default=None, max_length=64)  # IANA, e.g. "Asia/Tashkent"

    @field_validator("timezone")
    @classmethod
    def _zone(cls, v: str | None) -> str | None:
        if v is not None and not is_valid_zone(v):
            raise ValueError("unknown time zone")
        return v


class EventIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal[
        "tuner_opened",
        "write_access_requested",
        "write_access_granted",
        "premium_viewed",
        "game_start",
    ]
    ref: str = Field(default="", max_length=32)  # game_start: the game


# --- songs ---------------------------------------------------------------------

class ChordModel(BaseModel):
    """A chord in canonical form; the webapp renders it in the user's notation."""

    model_config = ConfigDict(extra="forbid")

    root: int = Field(ge=0, le=11)  # pitch class, 0 = C
    quality: Quality


class SongSummary(BaseModel):
    id: int
    title: str
    artist: str
    key: ChordModel
    capo: int
    difficulty: Difficulty
    language: str
    is_premium: bool
    is_published: bool
    duration_sec: int
    created_at: datetime
    # True when the song is premium and this user may not open it.
    locked: bool
    # First distinct chords of the timeline, for the list preview.
    chords_preview: list[ChordModel]

    @classmethod
    def build(cls, s: Song, *, locked: bool, preview: list[ChordModel]) -> "SongSummary":
        return cls(
            id=s.id,
            title=s.title,
            artist=s.artist,
            key=ChordModel(root=s.key_root, quality=s.key_quality),
            capo=s.capo,
            difficulty=s.difficulty,
            language=s.language,
            is_premium=s.is_premium,
            is_published=s.is_published,
            duration_sec=s.duration_sec,
            created_at=s.created_at,
            locked=locked,
            chords_preview=preview,
        )


class ContinueOut(BaseModel):
    song: SongSummary
    position_sec: float


class SongsOut(BaseModel):
    continue_playing: ContinueOut | None
    songs: list[SongSummary]


class SectionOut(BaseModel):
    id: int
    order: int
    title: str
    start_sec: float


class ChordEventOut(BaseModel):
    time_sec: float
    section_id: int | None
    root: int
    quality: Quality


class SongDetail(SongSummary):
    youtube_id: str
    sections: list[SectionOut]
    events: list[ChordEventOut]
    position_sec: float | None  # where this user stopped last time


class ProgressIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    position_sec: float = Field(ge=0)


# --- admin ---------------------------------------------------------------------

_YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


class KeyModel(ChordModel):
    @field_validator("quality")
    @classmethod
    def _major_or_minor(cls, v: Quality) -> Quality:
        if v not in (Quality.MAJOR, Quality.MINOR):
            raise ValueError("a key is major or minor")
        return v


class SongIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=255)
    artist: str = Field(min_length=1, max_length=255)
    youtube_id: str
    key: KeyModel
    capo: int = Field(default=0, ge=0, le=12)
    difficulty: Difficulty
    language: str = Field(default="uz", min_length=2, max_length=8)
    is_premium: bool = False
    duration_sec: int = Field(gt=0, le=60 * 60)

    @field_validator("youtube_id")
    @classmethod
    def _youtube_id(cls, v: str) -> str:
        if not _YOUTUBE_ID.match(v):
            raise ValueError("expected an 11-character YouTube video id")
        return v


class SongPatch(BaseModel):
    """Any subset of SongIn's fields."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=255)
    artist: str | None = Field(default=None, min_length=1, max_length=255)
    youtube_id: str | None = None
    key: KeyModel | None = None
    capo: int | None = Field(default=None, ge=0, le=12)
    difficulty: Difficulty | None = None
    language: str | None = Field(default=None, min_length=2, max_length=8)
    is_premium: bool | None = None
    duration_sec: int | None = Field(default=None, gt=0, le=60 * 60)

    @field_validator("youtube_id")
    @classmethod
    def _youtube_id(cls, v: str | None) -> str | None:
        if v is not None and not _YOUTUBE_ID.match(v):
            raise ValueError("expected an 11-character YouTube video id")
        return v


class SectionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=64)
    start_sec: float = Field(ge=0)


class ChordEventIn(ChordModel):
    time_sec: float = Field(ge=0)


class TimelineIn(BaseModel):
    """The whole timeline; replaces whatever the song had."""

    model_config = ConfigDict(extra="forbid")

    sections: list[SectionIn] = Field(default_factory=list, max_length=100)
    events: list[ChordEventIn] = Field(max_length=2000)


class PublishIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_published: bool


# --- chord detection ---------------------------------------------------------------

class AnalyzeYouTubeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    youtube_url: str = Field(min_length=1, max_length=500)


class AnalysisEventOut(BaseModel):
    start_sec: float
    end_sec: float
    chord: ChordModel | None  # None = no chord
    confidence: float


class AltTuningOut(BaseModel):
    name: str  # "Eb standard" | "D standard"
    shift: int  # semitones below standard; shapes = chords moved up by -shift


class AnalysisSummary(BaseModel):
    id: int
    source: AnalysisSource
    source_ref: str  # the YouTube URL or the uploaded file's name
    title: str | None
    youtube_id: str | None
    status: AnalysisStatus
    error_code: str | None
    cache_hit: bool
    key: ChordModel | None
    bpm: float | None
    duration_sec: float | None
    chords_preview: list[ChordModel]  # first distinct chords, like SongSummary
    tuning_offset_cents: float | None
    alt_tuning: AltTuningOut | None
    suggested_capo: int | None  # for standard tuning; 0 = none
    created_at: datetime
    finished_at: datetime | None

    @classmethod
    def build(cls, a: Analysis) -> "AnalysisSummary":
        return cls(**cls._fields(a))

    @staticmethod
    def _fields(a: Analysis) -> dict:
        preview: list[ChordModel] = []
        for e in a.events or []:
            if e["chord"] is None:
                continue
            chord = ChordModel(**e["chord"])
            if chord not in preview:
                preview.append(chord)
            if len(preview) == 4:
                break
        return {
            "id": a.id,
            "source": a.source,
            "source_ref": a.source_ref,
            "title": a.title,
            "youtube_id": a.youtube_id,
            "status": a.status,
            "error_code": a.error_code,
            "cache_hit": a.cache_hit,
            "key": None if a.key_root is None else ChordModel(root=a.key_root, quality=a.key_quality),
            "bpm": a.bpm,
            "duration_sec": a.duration_sec,
            "chords_preview": preview,
            "tuning_offset_cents": a.tuning_offset_cents,
            "alt_tuning": a.alt_tuning,
            "suggested_capo": a.suggested_capo,
            "created_at": a.created_at,
            "finished_at": a.finished_at,
        }


class AnalysisOut(AnalysisSummary):
    beats: list[float] | None  # set once done
    events: list[AnalysisEventOut] | None

    @classmethod
    def build(cls, a: Analysis) -> "AnalysisOut":
        return cls(**cls._fields(a), beats=a.beats, events=a.events)


class AnalysisHistoryOut(BaseModel):
    remaining_today: int | None  # None = unlimited (premium)
    daily_limit: int
    items: list[AnalysisSummary]


# --- premium payments ------------------------------------------------------------------

class PlanOut(BaseModel):
    id: str  # "month" | "year"
    days: int
    price: int  # soʻm


class PaymentOut(BaseModel):
    id: int
    plan: str
    days: int
    amount: int
    status: PaymentStatus
    note: str | None  # the admin's reason on reject
    created_at: datetime
    decided_at: datetime | None

    @classmethod
    def build(cls, p: Payment) -> "PaymentOut":
        return cls(
            id=p.id, plan=p.plan, days=p.days, amount=p.amount, status=p.status, note=p.note,
            created_at=p.created_at, decided_at=p.decided_at,
        )


class PaymentInfoOut(BaseModel):
    """What the premium sheet needs: where to pay, the plans, the user's latest request."""

    card: str
    card_holder: str
    plans: list[PlanOut]
    latest: PaymentOut | None  # pending, or the last decision


# --- admin panel ---------------------------------------------------------------------

class UserBrief(BaseModel):
    id: int
    telegram_id: int
    first_name: str
    last_name: str | None
    username: str | None
    photo_url: str | None

    @classmethod
    def build(cls, u: User) -> "UserBrief":
        return cls(
            id=u.id, telegram_id=u.telegram_id, first_name=u.first_name, last_name=u.last_name,
            username=u.username, photo_url=u.photo_url,
        )


class AdminUserRow(UserBrief):
    created_at: datetime
    last_seen_at: datetime
    has_premium: bool
    premium_forever: bool
    premium_until: datetime | None
    is_blocked_bot: bool
    pending_payment: bool

    @classmethod
    def row(cls, u: User, *, pending: bool) -> "AdminUserRow":
        return cls(
            **UserBrief.build(u).model_dump(),
            created_at=u.created_at,
            last_seen_at=u.last_seen_at,
            has_premium=u.has_premium,
            premium_forever=u.is_premium,
            premium_until=u.premium_until,
            is_blocked_bot=u.is_blocked_bot,
            pending_payment=pending,
        )


UserFilter = Literal["all", "premium", "active_free", "pending", "blocked"]


class AdminUsersOut(BaseModel):
    counts: dict[UserFilter, int]
    total: int  # matching the filter and search
    items: list[AdminUserRow]


class AdminPaymentOut(PaymentOut):
    user: UserBrief


class HistoryItem(BaseModel):
    kind: PremiumEventKind | Literal["expired"]
    days: int | None
    note: str | None
    admin_name: str | None
    created_at: datetime


class AdminUserStats(BaseModel):
    active_days: int  # days the app was opened
    songs: int  # songs played
    analyses: int


class AdminUserDetail(BaseModel):
    user: AdminUserRow
    stats: AdminUserStats
    pending: PaymentOut | None
    payments: list[PaymentOut]  # newest first
    history: list[HistoryItem]  # newest first


class GrantIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    days: int | None = Field(ge=1, le=3660)  # None = no end date
    note: str | None = Field(default=None, max_length=500)


class NoteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: str | None = Field(default=None, max_length=500)


class ApproveIn(NoteIn):
    days: int | None = Field(default=None, ge=1, le=3660)  # default: the plan's days


Period = Literal["today", "7d", "30d"]


class DayCount(BaseModel):
    day: date
    count: int


class FunnelStep(BaseModel):
    step: Literal["opened", "tuner", "song", "premium_viewed", "payment_sent", "approved"]
    users: int


class CatalogRequest(BaseModel):
    """Something users looked for that the catalog doesn't have."""

    title: str
    users: int  # distinct users who asked
    searches: int  # of them, through search
    analyses: int  # of them, through a YouTube analysis
    youtube_id: str | None


class AdminStatsOut(BaseModel):
    period: Period
    users_total: int
    users_new: int  # in the period
    premium: int
    active: int  # opened the app in the period
    active_free: int
    revenue_month: int  # approved payments this calendar month, soʻm
    new_by_day: list[DayCount]  # the last 14 days, oldest first
    funnel: list[FunnelStep]
    pending_count: int
    pending: list[AdminPaymentOut]  # oldest first, at most 5
    requests: list[CatalogRequest]


class SongLinkOut(BaseModel):
    url: str | None  # None until BOT_USERNAME is set
    opened: int  # distinct users who came through the link
    paid: int  # of them, who have had a payment approved


# --- practice -------------------------------------------------------------------------

# Server-side sanity limits for game results.
MAX_SWITCHES_PER_MIN = 60
EAR_TEST_QUESTIONS = 10


class StreakOut(BaseModel):
    current: int  # as of today: 0 once a missed day can't be frozen
    best: int
    freezes_left: int  # for this month
    last_practice_date: date | None


class TodayOut(BaseModel):
    date: date  # in the user's zone
    steps: list[PracticeStep]  # all of them, in order
    steps_done: list[PracticeStep]
    completed: bool
    chain: list[ChordModel]  # the chord-switch chain, Am → C → G → F by default
    streak: StreakOut


class StepIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    step: PracticeStep


class PersonalBestOut(BaseModel):
    game: Game
    chain_key: str
    value: int


class CollectedChord(ChordModel):
    mode: UnlockMode
    unlocked_at: datetime


class SummaryOut(BaseModel):
    streak: StreakOut
    today: TodayOut
    bests: list[PersonalBestOut]
    collection: list[CollectedChord]
    collectible: list[ChordModel]  # the whole collection, in order ("7/24")


class ChordSwitchDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chain: list[ChordModel] = Field(min_length=2, max_length=8)
    switches: int = Field(ge=0)  # correct chord changes
    chains: int = Field(ge=0)  # full times round the chain
    duration_sec: float = Field(ge=10, le=120)


class EarAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chord: ChordModel  # what was played
    picked: ChordModel | None  # None = no answer
    correct: bool


class EarTestDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")

    level: int = Field(ge=1, le=5)  # 1 = major vs minor
    answers: list[EarAnswer] = Field(min_length=EAR_TEST_QUESTIONS, max_length=EAR_TEST_QUESTIONS)


class GameResultIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    game: Game
    score: int = Field(ge=0)
    details: dict


class GameResultOut(BaseModel):
    id: int
    game: Game
    score: int
    best: int  # the personal best after this game
    new_best: bool
    today: TodayOut


class UnlockIn(ChordModel):
    mode: UnlockMode = UnlockMode.PLAYED
