"""Analysis rows: cache, daily limits and event logging. Shared by the API and the worker.

Import-light on purpose (no librosa): the API process loads it.
"""

import logging
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from chordb_common.config import get_settings
from chordb_common.models import Analysis, AnalysisStatus, User

from app.analysis import ENGINE_VERSION
from app.schemas import is_admin

events_log = logging.getLogger("chordb.events")

ACTIVE = (AnalysisStatus.QUEUED, AnalysisStatus.RUNNING)


def log_event(event: str, **fields: object) -> None:
    """One greppable line per event: `event=analyze_done analysis_id=5 user_id=3 …`."""
    parts = [f"event={event}"] + [f"{k}={v}" for k, v in fields.items() if v is not None]
    events_log.info(" ".join(parts))


def _same_media(youtube_id: str | None, file_hash: str | None):
    if youtube_id is not None:
        return Analysis.youtube_id == youtube_id
    assert file_hash is not None
    return Analysis.file_hash == file_hash


async def find_cached(
    session: AsyncSession, *, youtube_id: str | None = None, file_hash: str | None = None
) -> Analysis | None:
    """A finished result of this engine version for the same video or the same bytes."""
    return await session.scalar(
        select(Analysis)
        .where(
            _same_media(youtube_id, file_hash),
            Analysis.status == AnalysisStatus.DONE,
            Analysis.engine_version == ENGINE_VERSION,
        )
        .order_by(Analysis.id.desc())
        .limit(1)
    )


async def find_in_flight(
    session: AsyncSession, user: User, *, youtube_id: str | None = None,
    file_hash: str | None = None,
) -> Analysis | None:
    """This user's own queued/running job for the same media (a double tap, a retry)."""
    return await session.scalar(
        select(Analysis)
        .where(
            Analysis.user_id == user.id,
            _same_media(youtube_id, file_hash),
            Analysis.status.in_(ACTIVE),
        )
        .limit(1)
    )


def copy_cached(cached: Analysis, user: User, *, source_ref: str, title: str | None) -> Analysis:
    """A new done row for `user` carrying `cached`'s result."""
    now = datetime.now(UTC)
    return Analysis(
        user_id=user.id,
        source=cached.source,
        source_ref=source_ref,
        title=title or cached.title,
        youtube_id=cached.youtube_id,
        file_hash=cached.file_hash,
        status=AnalysisStatus.DONE,
        cache_hit=True,
        key_root=cached.key_root,
        key_quality=cached.key_quality,
        bpm=cached.bpm,
        duration_sec=cached.duration_sec,
        beats=cached.beats,
        events=cached.events,
        tuning_offset_cents=cached.tuning_offset_cents,
        alt_tuning=cached.alt_tuning,
        suggested_capo=cached.suggested_capo,
        engine_version=cached.engine_version,
        started_at=now,
        finished_at=now,
    )


def is_unlimited(user: User) -> bool:
    return user.is_premium or is_admin(user)


def _start_of_today() -> datetime:
    tz = ZoneInfo(get_settings().notify_tz)
    return datetime.now(tz).replace(hour=0, minute=0, second=0, microsecond=0)


async def remaining_today(session: AsyncSession, user: User) -> int | None:
    """Free analyses left today (in NOTIFY_TZ); None = unlimited.

    Counted: today's new analyses that did not fail. Cache hits are free.
    """
    if is_unlimited(user):
        return None
    used = await session.scalar(
        select(func.count())
        .select_from(Analysis)
        .where(
            Analysis.user_id == user.id,
            Analysis.cache_hit.is_(False),
            Analysis.status != AnalysisStatus.FAILED,
            Analysis.created_at >= _start_of_today(),
        )
    )
    return max(0, get_settings().analyze_free_per_day - (used or 0))
