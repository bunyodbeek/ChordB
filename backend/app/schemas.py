import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from chordb_common.config import get_settings
from chordb_common.models import Difficulty, NotationKind, Quality, Song, User


class SettingsOut(BaseModel):
    notation: NotationKind | None
    notifications_enabled: bool


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
    is_admin: bool  # may use /api/admin (ADMIN_IDS)

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
                notation=u.notation, notifications_enabled=u.notifications_enabled
            ),
            needs_write_access=(
                not u.can_message
                and not u.is_blocked_bot
                and u.write_access_requested_at is None
            ),
            is_premium=u.is_premium,
            is_admin=is_admin(u),
        )


def is_admin(u: User) -> bool:
    return u.telegram_id in get_settings().admin_id_set


class SettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    notation: NotationKind | None = None
    notifications_enabled: bool | None = None


class EventIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["tuner_opened", "write_access_requested", "write_access_granted"]


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
