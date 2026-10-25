import pytest

from chordb_common.strum import BPM_MAX, SEED, SLOTS_RE, mastered, top_bpm, unlocked_bpm


def test_seed_patterns_are_one_bar():
    assert [s for _, _, s, _, _ in SEED] == ["D-D-D-D-", "D-DU-UDU", "D-D-DUDU", "-U-U-U-U"]
    assert all(SLOTS_RE.match(s) for _, _, s, _, _ in SEED)
    assert not SLOTS_RE.match("D-D-D-D")  # seven slots
    assert not SLOTS_RE.match("D-D-D-Dd")


@pytest.mark.parametrize(
    "best, expected",
    [
        ({}, 60),
        ({60: 0.89}, 60),  # just short
        ({60: 0.9}, 80),
        ({50: 1.0}, 60),  # slower than the step doesn't count
        ({75: 0.95}, 80),  # 75 ≥ 60 passes the first step only
        ({100: 0.92}, 120),  # faster passes every step below it
        ({60: 0.9, 80: 0.9, 100: 0.9}, 120),
        ({120: 0.9}, BPM_MAX),  # the ladder done: everything open
    ],
)
def test_unlocked_bpm(best, expected):
    assert unlocked_bpm(best) == expected


def test_mastered_and_top():
    assert not mastered({100: 1.0})
    assert mastered({125: 0.9})
    assert top_bpm({}) is None
    assert top_bpm({60: 1.0, 80: 0.5, 70: 0.95}) == 70
