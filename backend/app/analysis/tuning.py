"""Which guitar tuning (and capo) a detected chord sequence was most likely played in.

The audio cannot tell these apart: an E shape on a guitar tuned a half step down
sounds exactly like Eb in standard tuning. So the choice is made on the shapes:
covers are overwhelmingly played with open, beginner-friendly shapes, and a song
whose chords are all barre chords in standard tuning but all open shapes a half
step down was most likely played half a step down (Eb standard).

Shapes for a tuning `shift` semitones below standard are the sounding chords
moved up by -shift; with a capo on fret c (standard tuning) they move down by c.
"""

from dataclasses import dataclass

from app.analysis.decode import N_STATE, Segment

# How easy each shape is in standard tuning, 1 = open chord. Index = root pitch class.
_MAJOR_EASE = [1.0, 0.2, 1.0, 0.2, 1.0, 0.6, 0.4, 1.0, 0.2, 1.0, 0.4, 0.4]
#              C    C#   D    Eb   E    F    F#   G    Ab   A    Bb   B
_MINOR_EASE = [0.4, 0.4, 1.0, 0.2, 1.0, 0.4, 0.6, 0.4, 0.2, 1.0, 0.2, 0.6]
#              Cm   C#m  Dm   Ebm  Em   Fm   F#m  Gm   Abm  Am   Bbm  Bm

# Down-tunings offered as an alternative, by shift.
ALT_TUNINGS = {-1: "Eb standard", -2: "D standard"}
# A down-tuning is suggested only when its shapes are clearly easier, and easy outright.
ALT_MARGIN = 0.25
ALT_MIN_EASE = 0.6
MAX_CAPO = 7
CAPO_MARGIN = 0.15


@dataclass(frozen=True)
class TuningAdvice:
    alt_tuning: dict | None  # {"name": "Eb standard", "shift": -1}
    suggested_capo: int  # for standard tuning; 0 = none
    ease: dict[int, float]  # shapes moved by k semitones -> score (for the evaluation)


def transpose_state(state: int, semitones: int) -> int:
    if state == N_STATE:
        return N_STATE
    base = 0 if state < 12 else 12
    return base + (state - base + semitones) % 12


def shape_ease(state: int) -> float:
    if state < 12:
        return _MAJOR_EASE[state]
    return _MINOR_EASE[state - 12]


def ease(segments: list[Segment], semitones: int) -> float:
    """Duration-weighted ease of the shapes after moving every chord by `semitones`."""
    total = weighted = 0.0
    for s in segments:
        if s.state == N_STATE:
            continue
        total += s.duration
        weighted += s.duration * shape_ease(transpose_state(s.state, semitones))
    return weighted / total if total > 0 else 0.0


def advise(segments: list[Segment]) -> TuningAdvice:
    scores = {k: ease(segments, k) for k in range(-MAX_CAPO, 3)}
    standard = scores[0]

    alt = None
    best_shift = max(ALT_TUNINGS, key=lambda shift: scores[-shift])
    alt_score = scores[-best_shift]
    if alt_score >= standard + ALT_MARGIN and alt_score >= ALT_MIN_EASE:
        alt = {"name": ALT_TUNINGS[best_shift], "shift": best_shift}

    # Lowest capo that is clearly easier than none (and than any lower capo).
    capo, capo_score = 0, standard
    for c in range(1, MAX_CAPO + 1):
        if scores[-c] >= capo_score + CAPO_MARGIN:
            capo, capo_score = c, scores[-c]
    return TuningAdvice(alt_tuning=alt, suggested_capo=capo, ease=scores)
