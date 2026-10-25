"""Strumming patterns and the rhythm trainer's tempo ladder. Pure: no database access.

A pattern is one bar of eight eighth notes, written as eight characters: D = down,
U = up, - = rest, x = a muted chuck. The trainer climbs 60 → 80 → 100 → 120 BPM; the
next tempo opens once the last four bars at the current one (or faster) were ≥ 90% on time.
"""

import re

SLOTS_PER_BAR = 8
SLOTS_RE = re.compile(r"^[DUx-]{8}$")

# Songs without a pattern of their own get Pop (the seed's id 2).
DEFAULT_PATTERN_ID = 2

# (id, name, slots, is_premium, sort): migration 0010 inserts these.
SEED: tuple[tuple[int, str, str, bool, int], ...] = (
    (1, "Asosiy", "D-D-D-D-", False, 1),
    (2, "Pop", "D-DU-UDU", False, 2),
    (3, "Balada", "D-D-DUDU", True, 3),
    (4, "Reggi", "-U-U-U-U", True, 4),
)

TIME_SIGNATURES = ("2/4", "3/4", "4/4", "6/8")
DEFAULT_TIME_SIGNATURE = "4/4"

BPM_MIN = 50
BPM_MAX = 140
BPM_STEP = 5
LADDER = (60, 80, 100, 120)
UNLOCK_ACCURACY = 0.9


def unlocked_bpm(best: dict[int, float]) -> int:
    """The fastest tempo the trainer allows, given the best accuracy at each tempo played.

    A ladder step counts as passed when some tempo at or above it reached UNLOCK_ACCURACY;
    passing one opens the next. Past the top step everything up to BPM_MAX is open.
    """
    for i, step in enumerate(LADDER):
        if not any(bpm >= step and acc >= UNLOCK_ACCURACY for bpm, acc in best.items()):
            return step
        if i + 1 == len(LADDER):
            return BPM_MAX
    return BPM_MAX  # unreachable: LADDER is not empty


def mastered(best: dict[int, float]) -> bool:
    """The whole ladder passed: ≥ 90% at the top step or faster."""
    return any(bpm >= LADDER[-1] and acc >= UNLOCK_ACCURACY for bpm, acc in best.items())


def top_bpm(best: dict[int, float]) -> int | None:
    """The fastest tempo played at ≥ 90%, or None."""
    return max((bpm for bpm, acc in best.items() if acc >= UNLOCK_ACCURACY), default=None)
