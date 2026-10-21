"""Daily practice rules, shared by the API and the bot. Pure: no database access.

A practice day is a calendar day in the user's time zone. Doing all of STEPS completes it;
completed days in a row make the streak. A missed day can be covered by a freeze: one per
month (premium: three), refilled at the start of each month and not carried over.
"""

from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from chordb_common.config import get_settings
from chordb_common.models import PracticeStep, Quality

STEPS: tuple[PracticeStep, ...] = (PracticeStep.TUNE, PracticeStep.CHORD_SWITCH, PracticeStep.EAR_TEST)
FREEZES_FREE = 1
FREEZES_PREMIUM = 3
DEFAULT_PRACTICE_HOUR = 20

# The chord collection (practice-hub "7/24"): beginner chords first, then the barre ones.
COLLECTIBLE: tuple[tuple[int, Quality], ...] = (
    (9, Quality.MINOR), (0, Quality.MAJOR), (7, Quality.MAJOR), (4, Quality.MINOR),
    (2, Quality.MAJOR), (4, Quality.MAJOR), (9, Quality.MAJOR), (5, Quality.MAJOR),
    (2, Quality.MINOR), (11, Quality.DOM7), (11, Quality.MINOR), (6, Quality.MINOR),
    (9, Quality.DOM7), (2, Quality.DOM7), (4, Quality.DOM7), (7, Quality.DOM7),
    (0, Quality.DOM7), (0, Quality.MAJ7), (5, Quality.MAJ7), (9, Quality.MIN7),
    (4, Quality.MIN7), (2, Quality.MIN7), (10, Quality.MAJOR), (1, Quality.MINOR),
)

# The default chord-switch chain: Am → C → G → F.
DEFAULT_CHAIN: tuple[tuple[int, Quality], ...] = (
    (9, Quality.MINOR), (0, Quality.MAJOR), (7, Quality.MAJOR), (5, Quality.MAJOR),
)


def zone(name: str | None) -> ZoneInfo:
    """The user's zone, falling back to NOTIFY_TZ for unknown or missing names."""
    if name:
        try:
            return ZoneInfo(name)
        except (ZoneInfoNotFoundError, ValueError):
            pass
    return ZoneInfo(get_settings().notify_tz)


def is_valid_zone(name: str) -> bool:
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True


def local_date(now: datetime, tz_name: str | None) -> date:
    return now.astimezone(zone(tz_name)).date()


def freeze_allowance(premium: bool) -> int:
    return FREEZES_PREMIUM if premium else FREEZES_FREE


@dataclass(frozen=True)
class StreakState:
    current: int = 0
    best: int = 0
    last_practice_date: date | None = None
    freezes_left: int = 0
    freezes_month: date | None = None


def refill(state: StreakState, day: date, premium: bool) -> StreakState:
    """A new month gives a fresh set of freezes (unused ones don't carry over)."""
    month = day.replace(day=1)
    if state.freezes_month == month:
        return state
    return replace(state, freezes_left=freeze_allowance(premium), freezes_month=month)


def complete_day(state: StreakState, day: date, *, premium: bool = False) -> StreakState:
    """The streak after the practice of `day` is completed. Idempotent for the same day."""
    state = refill(state, day, premium)
    last = state.last_practice_date
    if last is not None and day <= last:
        return state  # the same day again (or a late write for an older day)
    if last is None:
        current, freezes = 1, state.freezes_left
    else:
        missed = (day - last).days - 1
        if missed == 0:
            current, freezes = state.current + 1, state.freezes_left
        elif missed <= state.freezes_left:
            current, freezes = state.current + 1, state.freezes_left - missed
        else:
            current, freezes = 1, state.freezes_left
    return replace(
        state,
        current=current,
        best=max(state.best, current),
        last_practice_date=day,
        freezes_left=freezes,
    )


def current_streak(state: StreakState, today: date, *, premium: bool = False) -> int:
    """The streak as shown today: still alive if every missed day can be frozen."""
    last = state.last_practice_date
    if last is None:
        return 0
    missed = (today - last).days - 1
    if missed <= 0:
        return state.current
    return state.current if missed <= refill(state, today, premium).freezes_left else 0


def usual_hour(times: Iterable[datetime], tz_name: str | None) -> int:
    """The local hour the user usually practises at (the most common one); 20 if unknown."""
    tz = zone(tz_name)
    hours = Counter(t.astimezone(tz).hour for t in times)
    if not hours:
        return DEFAULT_PRACTICE_HOUR
    # Ties go to the later hour: a reminder slightly late beats one before they're free.
    return max(hours.items(), key=lambda kv: (kv[1], kv[0]))[0]


def reminder_due(now: datetime, tz_name: str | None, hour: int) -> bool:
    """Whether `now` falls in the user's reminder hour (the job runs several times an hour)."""
    return now.astimezone(zone(tz_name)).hour == hour


def day_bounds(day: date, tz_name: str | None) -> tuple[datetime, datetime]:
    """The UTC instants a local calendar day starts and ends at."""
    tz = zone(tz_name)
    start = datetime.combine(day, datetime.min.time(), tzinfo=tz)
    return start, start + timedelta(days=1)
