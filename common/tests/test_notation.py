import pytest

from chordb_common.models import NotationKind
from chordb_common.notation import Chord, Note, Quality, format_chord, format_note, parse_chord

L, S = NotationKind.LETTER, NotationKind.SOLFEGE


@pytest.mark.parametrize(
    "symbol, letter, solfege",
    [
        ("Am", "Am", "Lya minor"),
        ("Em", "Em", "Mi minor"),
        ("C", "C", "Do major"),
        ("G7", "G7", "Sol 7"),
        ("Dm7", "Dm7", "Re minor 7"),
        ("Fmaj7", "Fmaj7", "Fa major 7"),
        ("F#m", "F#m", "Fa diyez minor"),
        ("Bb", "Bb", "Si bemol major"),
        ("Bdim", "Bdim", "Si dim"),
        ("Esus4", "Esus4", "Mi sus4"),
    ],
)
def test_chords(symbol: str, letter: str, solfege: str) -> None:
    chord = parse_chord(symbol)
    assert format_chord(chord, L) == letter
    assert format_chord(chord, S) == solfege


def test_canonical() -> None:
    assert parse_chord("Am") == Chord(root=9, quality=Quality.MINOR)


def test_notes() -> None:
    assert format_note(Note(4, 2), L) == "E2"
    assert format_note(Note(4, 2), S) == "Mi 2"
    assert format_note(Note(9), S) == "Lya"
    assert format_note(Note(11), S) == "Si"
    assert format_note(Note(1), L) == "C#"
    assert format_note(Note(1, flat=True), L) == "Db"


def test_bad_symbol() -> None:
    with pytest.raises(ValueError):
        parse_chord("H7")
