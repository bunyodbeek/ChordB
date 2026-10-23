"""Ear-test levels and the question generator. Pure: no database access.

Eight levels, each a pool of chords (level 8: four-chord progressions). A run is ten
questions; the next level opens only after 10/10. The server keeps the answers: the
webapp gets the options and the voicing to play, never which option is right.

Chords are written by their usual guitar names here ("F#m", "Bb") and stored as
root pitch class + quality, like everywhere else.
"""

import random
from dataclasses import dataclass
from itertools import permutations
from typing import Literal

from chordb_common.models import Quality

QUESTIONS = 10
RUN_MINUTES = 30
OPTIONS = 4
LEVEL_COUNT = 8
FIRST_PREMIUM_LEVEL = 5

ChordT = tuple[int, Quality]
Item = tuple[ChordT, ...]  # one chord, or a progression
Kind = Literal["quality", "chord", "progression"]

_LETTER_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_SUFFIX = {"": Quality.MAJOR, "m": Quality.MINOR, "7": Quality.DOM7}


def chord(name: str) -> ChordT:
    """'F#m' → (6, min). Only what the levels use: a letter, #/b, '', 'm' or '7'."""
    pc, rest = _LETTER_PC[name[0]], name[1:]
    if rest[:1] in ("#", "b"):
        pc += 1 if rest[0] == "#" else -1
        rest = rest[1:]
    return pc % 12, _SUFFIX[rest]


# Frets per string, string 6 (low E) first; -1 = not played. The open shapes match
# webapp/src/chords.ts; the barre chords are real barre shapes, played and drawn as
# such: F and Bb at the 1st fret, Bm F#m B at the 2nd, Gm at the 3rd, C#m at the 4th.
VOICINGS: dict[ChordT, list[int]] = {
    chord(n): f
    for n, f in {
        "C": [-1, 3, 2, 0, 1, 0],
        "G": [3, 2, 0, 0, 0, 3],
        "D": [-1, -1, 0, 2, 3, 2],
        "A": [-1, 0, 2, 2, 2, 0],
        "E": [0, 2, 2, 1, 0, 0],
        "Am": [-1, 0, 2, 2, 1, 0],
        "Em": [0, 2, 2, 0, 0, 0],
        "Dm": [-1, -1, 0, 2, 3, 1],
        "F": [1, 3, 3, 2, 1, 1],
        "Bm": [-1, 2, 4, 4, 3, 2],
        "F#m": [2, 4, 4, 2, 2, 2],
        "B": [-1, 2, 4, 4, 4, 2],
        "Bb": [-1, 1, 3, 3, 3, 1],
        "C#m": [-1, 4, 6, 6, 5, 4],
        "Gm": [3, 5, 5, 3, 3, 3],
        "Cm": [-1, 3, 5, 5, 4, 3],  # only for hearing a level-1 mistake (C → Cm)
        "G7": [3, 2, 0, 0, 0, 1],
        "D7": [-1, -1, 0, 2, 1, 2],
        "E7": [0, 2, 0, 1, 0, 0],
        "A7": [-1, 0, 2, 0, 2, 0],
        "B7": [-1, 2, 1, 2, 0, 2],
        "C7": [-1, 3, 2, 3, 1, 0],
    }.items()
}

# Chords easily heard as each other, most alike first: wrong options come from here
# when the level's pool has them (Am↔C, Em↔G, Dm↔F, D↔Bm, G↔G7, …).
SIMILAR: dict[ChordT, tuple[ChordT, ...]] = {
    chord(k): tuple(chord(n) for n in v.split())
    for k, v in {
        "C": "Am F G",
        "G": "Em C D G7",
        "D": "Bm Dm A D7",
        "A": "F#m Am E A7",
        "E": "Em C#m A E7",
        "Am": "C Dm Em",
        "Em": "G Am E",
        "Dm": "F D Am",
        "F": "Dm C Bb",
        "Bm": "D F#m B",
        "F#m": "A Bm C#m",
        "B": "Bm B7 E",
        "Bb": "Gm F B",
        "C#m": "E F#m",
        "Gm": "Bb Dm",
        "G7": "G C7 D7",
        "D7": "D A7 G7",
        "E7": "E A7 B7",
        "A7": "A E7 D7",
        "B7": "B E7",
        "C7": "C G7",
    }.items()
}


@dataclass(frozen=True)
class EarLevel:
    number: int
    title: str
    kind: Kind
    pool: tuple[Item, ...]
    shown: tuple[tuple[ChordT, ...], ...]  # what the levels map lists, groups split by "·"
    note: str = ""  # after them, or instead ("4 akkordli ketma-ketlik")

    @property
    def premium(self) -> bool:
        return self.number >= FIRST_PREMIUM_LEVEL


def _chords(names: str) -> tuple[ChordT, ...]:
    return tuple(chord(n) for n in names.split())


def _singles(names: str) -> tuple[Item, ...]:
    return tuple((c,) for c in _chords(names))


_OPEN = "C G D A E Am Em Dm"
_PROGRESSIONS = (
    "C G Am F", "G D Em C", "Am F C G", "D A Bm G",
    "C Am F G", "Em C G D", "A E F#m D", "G Em C D",
)

def _shown(*groups: str) -> tuple[tuple[ChordT, ...], ...]:
    return tuple(_chords(g) for g in groups)


LEVELS: tuple[EarLevel, ...] = (
    EarLevel(1, "Major yoki minor?", "quality", _singles(_OPEN), _shown("C G D A E", "Am Em Dm")),
    EarLevel(2, "Ochiq major", "chord", _singles("C G D A E"), _shown("C G D A E")),
    EarLevel(3, "Ochiq minor", "chord", _singles("Am Em Dm"), _shown("Am Em Dm")),
    EarLevel(4, "Aralash ochiq", "chord", _singles(_OPEN), (), "major + minor"),
    EarLevel(5, "Birinchi barre", "chord", _singles("F Bm " + _OPEN), _shown("F Bm"), "+ ochiq"),
    EarLevel(6, "Barre akkordlar", "chord", _singles("F#m B Bb C#m Gm F Bm"), _shown("F#m B Bb C#m Gm"), "+ F Bm"),
    EarLevel(7, "7-akkordlar", "chord", _singles("G7 D7 E7 A7 B7 C7 G D E"), _shown("G7 D7 E7 A7 B7 C7"), "+ ochiq"),
    EarLevel(
        8, "Progressiyalar", "progression",
        tuple(_chords(p) for p in _PROGRESSIONS), (), "4 akkordli ketma-ketlik",
    ),
)
assert [lv.number for lv in LEVELS] == list(range(1, LEVEL_COUNT + 1))
assert all(c in VOICINGS for lv in LEVELS for item in lv.pool for c in item)
# Level 1's contrasts: every pool chord in the other quality.
assert all(
    (r, Quality.MINOR if q == Quality.MAJOR else Quality.MAJOR) in VOICINGS
    for ((r, q),) in LEVELS[0].pool
)


def level(number: int) -> EarLevel:
    return LEVELS[number - 1]


# --- option ids: what the webapp sends back as its choice ---------------------------

def item_id(item: Item) -> str:
    """'9:min' for a chord, '0:maj,7:maj,9:min,5:maj' for a progression."""
    return ",".join(f"{r}:{q.value}" for r, q in item)


def parse_id(option: str) -> Item:
    """The chords of an option id; () for the level-1 answers 'maj' / 'min'."""
    if option in (Quality.MAJOR, Quality.MINOR):
        return ()
    out = []
    for part in option.split(","):
        r, _, q = part.partition(":")
        out.append((int(r), Quality(q)))
    return tuple(out)


# --- the generator ------------------------------------------------------------------

def _feasible(counts: dict[Item, int], prev: Item | None) -> bool:
    """Whether `counts` can be lined up with no item twice in a row, not starting with prev."""
    n = sum(counts.values())
    return all(c <= ((n // 2) if item == prev else (n + 1) // 2) for item, c in counts.items())


def sequence(pool: tuple[Item, ...], rand: random.Random, n: int = QUESTIONS) -> list[Item]:
    """n items from the pool: every item at least once, never the same one twice in a row."""
    if len(pool) > n or len(pool) < 2:
        raise ValueError("the pool must have 2..n items")
    counts = dict.fromkeys(pool, 1)
    while sum(counts.values()) < n:
        extra = rand.choice(pool)
        counts[extra] += 1
        if not _feasible(counts, None):
            counts[extra] -= 1
    out: list[Item] = []
    prev: Item | None = None
    for _ in range(n):
        choices = []
        for item, c in counts.items():
            if c == 0 or item == prev:
                continue
            counts[item] -= 1
            if _feasible(counts, item):
                choices.append(item)
            counts[item] += 1
        prev = rand.choice(choices)
        counts[prev] -= 1
        out.append(prev)
    return out


def _chord_options(lv: EarLevel, answer: Item, rand: random.Random) -> list[str]:
    others = [it for it in lv.pool if it != answer]
    want = min(OPTIONS - 1, len(others))
    similar = [(c,) for c in SIMILAR.get(answer[0], ()) if (c,) in others]
    rand.shuffle(similar)
    # One or two look-alikes, the rest at random: the set of options alone must not
    # give the answer away.
    picked = similar[: rand.randint(1, 2)]
    rest = [it for it in others if it not in picked]
    rand.shuffle(rest)
    return [item_id(it) for it in [answer, *picked, *rest][: want + 1]]


def _progression_options(answer: Item, rand: random.Random) -> list[str]:
    # The same chords in another order, starting on the same chord: only the order
    # tells them apart.
    first, *tail = answer
    orders = [(first, *p) for p in permutations(tail) if (first, *p) != answer]
    rand.shuffle(orders)
    return [item_id(answer), *(item_id(o) for o in orders[: OPTIONS - 1])]


def make_questions(number: int, rand: random.Random | None = None) -> list[dict]:
    """A run's questions, answers included (server side only).

    Each: {"chords": [[root, quality], …] played, "answer": option id,
    "options": [option id, …] in the order shown}.
    """
    rand = rand or random.SystemRandom()
    lv = level(number)
    out = []
    for item in sequence(lv.pool, rand):
        if lv.kind == "quality":
            answer = item[0][1].value
            options = [Quality.MAJOR.value, Quality.MINOR.value]
        else:
            answer = item_id(item)
            options = (
                _progression_options(item, rand)
                if lv.kind == "progression"
                else _chord_options(lv, item, rand)
            )
        rand.shuffle(options)
        out.append({
            "chords": [[r, q.value] for r, q in item],
            "answer": answer,
            "options": options,
        })
    return out


def contrast(answer_id: str, played: Item) -> Item:
    """What a level-1 "Major"/"Minor" answer sounds like for the played chord: the same
    root in that quality (Am → A), so the mistake can be heard side by side."""
    root = played[0][0]
    return ((root, Quality(answer_id)),)


def voicing(c: ChordT) -> list[int]:
    """Frets to play `c` with; every chord in the levels (and their contrasts) has one."""
    return VOICINGS[c]
