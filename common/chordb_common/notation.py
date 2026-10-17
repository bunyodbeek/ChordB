"""Canonical notes/chords and the single place that renders them as text.

Notes are stored as a pitch class (0 = C … 11 = B) plus an optional octave;
chords as root pitch class + quality. How they are shown depends on the user's
notation setting: letter ("Am") or solfège ("Lya minor").

webapp/src/notation.ts mirrors these tables — keep them in sync.
"""

import re
from dataclasses import dataclass
from enum import StrEnum

from chordb_common.models import NotationKind


class Quality(StrEnum):
    MAJOR = "maj"
    MINOR = "min"
    DOM7 = "7"
    MAJ7 = "maj7"
    MIN7 = "m7"
    DIM = "dim"
    AUG = "aug"
    SUS2 = "sus2"
    SUS4 = "sus4"


# Natural notes by pitch class.
_LETTER = {0: "C", 2: "D", 4: "E", 5: "F", 7: "G", 9: "A", 11: "B"}
_SOLFEGE = {0: "Do", 2: "Re", 4: "Mi", 5: "Fa", 7: "Sol", 9: "Lya", 11: "Si"}

_LETTER_SUFFIX = {
    Quality.MAJOR: "",
    Quality.MINOR: "m",
    Quality.DOM7: "7",
    Quality.MAJ7: "maj7",
    Quality.MIN7: "m7",
    Quality.DIM: "dim",
    Quality.AUG: "aug",
    Quality.SUS2: "sus2",
    Quality.SUS4: "sus4",
}
_SOLFEGE_SUFFIX = {
    Quality.MAJOR: "major",
    Quality.MINOR: "minor",
    Quality.DOM7: "7",
    Quality.MAJ7: "major 7",
    Quality.MIN7: "minor 7",
    Quality.DIM: "dim",
    Quality.AUG: "aug",
    Quality.SUS2: "sus2",
    Quality.SUS4: "sus4",
}


@dataclass(frozen=True)
class Note:
    pc: int  # pitch class 0..11
    octave: int | None = None
    flat: bool = False  # spell accidentals as flats (Bb) instead of sharps (A#)


@dataclass(frozen=True)
class Chord:
    root: int  # pitch class 0..11
    quality: Quality = Quality.MAJOR
    flat: bool = False


def note_name(pc: int, notation: NotationKind, *, flat: bool = False) -> str:
    pc %= 12
    names = _LETTER if notation == NotationKind.LETTER else _SOLFEGE
    if pc in names:
        return names[pc]
    if notation == NotationKind.LETTER:
        return names[(pc + 1) % 12] + "b" if flat else names[pc - 1] + "#"
    return names[(pc + 1) % 12] + " bemol" if flat else names[pc - 1] + " diyez"


def format_note(note: Note, notation: NotationKind) -> str:
    name = note_name(note.pc, notation, flat=note.flat)
    if note.octave is None:
        return name
    sep = "" if notation == NotationKind.LETTER else " "
    return f"{name}{sep}{note.octave}"


def format_chord(chord: Chord, notation: NotationKind) -> str:
    root = note_name(chord.root, notation, flat=chord.flat)
    if notation == NotationKind.LETTER:
        return root + _LETTER_SUFFIX[chord.quality]
    return f"{root} {_SOLFEGE_SUFFIX[chord.quality]}"


_CHORD_RE = re.compile(r"^([A-G])([#b]?)(.*)$")
_SUFFIX_TO_QUALITY = {v: k for k, v in _LETTER_SUFFIX.items()}
_LETTER_TO_PC = {v: k for k, v in _LETTER.items()}


def parse_chord(symbol: str) -> Chord:
    """Parse a letter chord symbol such as "Am", "G7", "Bbmaj7", "F#m"."""
    m = _CHORD_RE.match(symbol.strip())
    if not m or m.group(3) not in _SUFFIX_TO_QUALITY:
        raise ValueError(f"Unknown chord symbol: {symbol!r}")
    letter, accidental, suffix = m.groups()
    pc = _LETTER_TO_PC[letter] + {"": 0, "#": 1, "b": -1}[accidental]
    return Chord(root=pc % 12, quality=_SUFFIX_TO_QUALITY[suffix], flat=accidental == "b")
