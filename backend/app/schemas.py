from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from chordb_common.models import NotationKind, User


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
        )


class SettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    notation: NotationKind | None = None
    notifications_enabled: bool | None = None


class EventIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["tuner_opened", "write_access_requested", "write_access_granted"]
