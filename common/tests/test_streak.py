from datetime import UTC, date, datetime

import pytest

from chordb_common.practice import (
    StreakState,
    complete_day,
    current_streak,
    local_date,
    reminder_due,
    usual_hour,
)

D = date(2026, 10, 14)


def days(*ds: date, premium: bool = False, start: StreakState | None = None) -> StreakState:
    s = start or StreakState()
    for d in ds:
        s = complete_day(s, d, premium=premium)
    return s


def nth(n: int) -> date:
    return date(2026, 10, n)


class TestComplete:
    def test_first_day(self):
        s = days(D)
        assert (s.current, s.best, s.last_practice_date) == (1, 1, D)
        assert s.freezes_left == 1  # this month's free freeze

    def test_same_day_twice_counts_once(self):
        assert days(D, D).current == 1

    def test_next_day(self):
        s = days(nth(14), nth(15), nth(16))
        assert (s.current, s.best) == (3, 3)

    def test_missed_day_with_freeze(self):
        s = days(nth(14), nth(15), nth(17))  # the 16th is frozen
        assert (s.current, s.freezes_left) == (3, 0)

    def test_missed_day_without_freeze(self):
        # The free freeze went on the 16th; missing the 19th breaks the streak.
        s = days(nth(14), nth(15), nth(17), nth(18), nth(20))
        assert (s.current, s.best) == (1, 4)

    def test_two_missed_days_need_two_freezes(self):
        assert days(nth(14), nth(17)).current == 1  # free: one freeze only
        s = days(nth(14), nth(17), premium=True)  # premium: three
        assert (s.current, s.freezes_left) == (2, 1)

    def test_freezes_refill_monthly_without_carry_over(self):
        s = days(nth(28), premium=True)
        assert s.freezes_left == 3
        s = complete_day(s, date(2026, 11, 1), premium=False)  # premium ran out
        assert (s.freezes_left, s.freezes_month) == (1, date(2026, 11, 1))

    def test_older_day_is_ignored(self):
        s = days(nth(15), nth(14))
        assert (s.current, s.last_practice_date) == (1, nth(15))


class TestShown:
    def test_alive_today_and_yesterday(self):
        s = days(nth(14), nth(15))
        assert current_streak(s, nth(15)) == 2
        assert current_streak(s, nth(16)) == 2  # today not done yet: still alive

    def test_one_missed_day_is_covered_by_the_freeze(self):
        s = days(nth(14), nth(15))
        assert current_streak(s, nth(17)) == 2
        assert current_streak(s, nth(18)) == 0

    def test_never_practised(self):
        assert current_streak(StreakState(), nth(14)) == 0


class TestTimezones:
    def test_local_date_in_tashkent(self):
        # 19:30 UTC is already 00:30 the next day in Tashkent (UTC+5).
        late = datetime(2026, 10, 14, 19, 30, tzinfo=UTC)
        assert local_date(late, "Asia/Tashkent") == nth(15)
        assert local_date(late, "Europe/London") == nth(14)
        assert local_date(late, None) == nth(15)  # NOTIFY_TZ default
        assert local_date(late, "Not/AZone") == nth(15)

    def test_practice_either_side_of_local_midnight_is_two_days(self):
        before = datetime(2026, 10, 14, 18, 50, tzinfo=UTC)  # 23:50 Tashkent
        after = datetime(2026, 10, 14, 19, 10, tzinfo=UTC)  # 00:10 Tashkent, the 15th
        s = days(local_date(before, "Asia/Tashkent"), local_date(after, "Asia/Tashkent"))
        assert s.current == 2

    def test_same_utc_day_can_be_two_local_days_and_vice_versa(self):
        a = datetime(2026, 10, 14, 1, 0, tzinfo=UTC)  # 06:00 Tashkent the 14th
        b = datetime(2026, 10, 14, 20, 0, tzinfo=UTC)  # 01:00 Tashkent the 15th
        assert local_date(a, "Asia/Tashkent") != local_date(b, "Asia/Tashkent")
        assert local_date(a, "America/New_York") == nth(13)
        assert local_date(b, "America/New_York") == nth(14)


class TestReminderHour:
    def test_default_is_20(self):
        assert usual_hour([], "Asia/Tashkent") == 20

    def test_most_common_local_hour(self):
        times = [datetime(2026, 10, d, 16, 5, tzinfo=UTC) for d in (10, 11, 12)]  # 21:05 local
        times.append(datetime(2026, 10, 13, 3, 0, tzinfo=UTC))
        assert usual_hour(times, "Asia/Tashkent") == 21

    @pytest.mark.parametrize(("utc_hour", "due"), [(14, False), (15, True), (16, False)])
    def test_due_in_that_local_hour(self, utc_hour, due):
        now = datetime(2026, 10, 14, utc_hour, 30, tzinfo=UTC)
        assert reminder_due(now, "Asia/Tashkent", 20) is due
