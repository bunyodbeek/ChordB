import pytest

from chordb_common.difficulty import auto_difficulty
from chordb_common.ear import chord
from chordb_common.models import Difficulty


def chords(symbols: str) -> list:
    return [chord(s) for s in symbols.split()]


@pytest.mark.parametrize(
    "symbols, capo, expected",
    [
        ("", 0, Difficulty.EASY),
        ("Am F C G", 0, Difficulty.MEDIUM),  # F is a barre
        ("Em C G D", 0, Difficulty.EASY),
        ("Am C G Am C", 0, Difficulty.EASY),  # repeats count once
        ("Am Dm E Am", 0, Difficulty.EASY),
        ("C G Am Em F", 0, Difficulty.MEDIUM),
        ("C G Am Em D A E", 0, Difficulty.HARD),  # seven shapes, all open
        ("F Bm C G", 0, Difficulty.HARD),  # two barres
        ("Fm Bbm Eb Ab", 0, Difficulty.HARD),
        ("Fm Bbm Eb Ab", 1, Difficulty.EASY),  # capo 1: Em Am D G
        ("Bb F Gm Eb", 3, Difficulty.EASY),  # capo 3: G D Em C
    ],
)
def test_auto_difficulty(symbols, capo, expected):
    assert auto_difficulty(chords(symbols), capo) == expected
