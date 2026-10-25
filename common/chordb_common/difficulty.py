"""A song's automatic difficulty, from the chord shapes it needs.

The shapes are the timeline's chords moved down by the capo (what the hands play). A
shape is "open" when webapp/src/chords.ts has an open voicing for it (its OPEN table);
everything else is played as a barre there.
"""

from collections.abc import Iterable

from chordb_common.models import Difficulty, Quality

Q = Quality
C, D, E, G, A, B = 0, 2, 4, 7, 9, 11
F = 5

OPEN_SHAPES: frozenset[tuple[int, Quality]] = frozenset(
    [(r, Q.MAJOR) for r in (C, A, G, E, D)]
    + [(r, Q.MINOR) for r in (A, E, D)]
    + [(r, Q.DOM7) for r in (C, A, G, E, D, B)]
    + [(r, Q.MIN7) for r in (A, E, D)]
    + [(r, Q.MAJ7) for r in (C, F, A, D, E, G)]
    + [(r, Q.SUS2) for r in (A, D)]
    + [(r, Q.SUS4) for r in (A, D, E)]
)

EASY_MAX_CHORDS = 4  # and no barre
HARD_MIN_CHORDS = 7
HARD_MIN_BARRES = 2


def auto_difficulty(chords: Iterable[tuple[int, Quality]], capo: int = 0) -> Difficulty:
    """Easy: up to 4 shapes, all open. Hard: 2+ barre shapes or 7+ shapes. Else medium."""
    shapes = {((root - capo) % 12, Quality(quality)) for root, quality in chords}
    barres = len(shapes - OPEN_SHAPES)
    if barres >= HARD_MIN_BARRES or len(shapes) >= HARD_MIN_CHORDS:
        return Difficulty.HARD
    if barres == 0 and len(shapes) <= EASY_MAX_CHORDS:
        return Difficulty.EASY
    return Difficulty.MEDIUM
