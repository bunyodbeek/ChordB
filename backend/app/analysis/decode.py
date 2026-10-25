"""Beat chroma -> key and chord segments. Pure numpy (plus librosa's Viterbi), no audio I/O.

Vocabulary: 12 major + 12 minor triads + N (no chord). State i < 12 is major with
root i, 12 <= i < 24 is minor with root i - 12, and 24 is N.
"""

from dataclasses import dataclass, replace

import librosa
import numpy as np

from chordb_common.models import Quality

N_STATE = 24
N_STATES = 25

# Krumhansl-Kessler key profiles, index 0 = tonic.
KK_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KK_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


@dataclass(frozen=True)
class DecodeConfig:
    # Emission multiplier for chords diatonic to the detected key (1.0 = no prior).
    key_boost: float = 1.5
    # Emission multiplier for every other chord (N is never penalised).
    non_diatonic: float = 0.9
    # Viterbi probability of staying on the same chord from one beat to the next (per
    # beat: with half-beat steps each step stays with its square root).
    self_transition: float = 0.85
    # Softmax temperature turning cosine similarities into emission probabilities.
    temperature: float = 0.05
    # The N template's similarity is scaled by this; lower = N chosen less often.
    n_weight: float = 0.85
    # Added to a chord's similarity when its root is the bass note (bass chroma 0..1).
    bass_weight: float = 0.1

    def without_key_prior(self) -> "DecodeConfig":
        return replace(self, key_boost=1.0, non_diatonic=1.0)


@dataclass(frozen=True)
class Key:
    root: int  # pitch class 0..11
    quality: Quality  # MAJOR or MINOR
    confidence: float  # Pearson correlation with the winning profile


@dataclass
class Segment:
    start_sec: float
    end_sec: float
    state: int  # index into the vocabulary; N_STATE = no chord
    confidence: float

    @property
    def duration(self) -> float:
        return self.end_sec - self.start_sec


def state_chord(state: int) -> tuple[int, Quality] | None:
    """(root, quality) of a vocabulary state, or None for N."""
    if state == N_STATE:
        return None
    return (state % 12, Quality.MAJOR if state < 12 else Quality.MINOR)


def chord_state(root: int, quality: Quality) -> int:
    return root % 12 + (0 if quality == Quality.MAJOR else 12)


def templates() -> np.ndarray:
    """(25, 12) L2-normalised binary chord templates. N is flat."""
    t = np.zeros((N_STATES, 12))
    for root in range(12):
        for pc in (0, 4, 7):
            t[root, (root + pc) % 12] = 1
        for pc in (0, 3, 7):
            t[12 + root, (root + pc) % 12] = 1
    t[N_STATE] = 1
    return t / np.linalg.norm(t, axis=1, keepdims=True)


_TEMPLATES = templates()


def similarities(chroma: np.ndarray, n_weight: float) -> np.ndarray:
    """Cosine similarity of each beat's chroma (12, T) to each template -> (25, T)."""
    norm = np.linalg.norm(chroma, axis=0, keepdims=True)
    unit = np.divide(chroma, norm, out=np.zeros_like(chroma), where=norm > 0)
    sim = _TEMPLATES @ unit
    sim[N_STATE] *= n_weight
    return sim


def estimate_key(global_chroma: np.ndarray) -> Key:
    """Best of the 24 Krumhansl-Kessler profiles by Pearson correlation."""
    best = Key(0, Quality.MAJOR, -2.0)
    if not np.any(global_chroma > 0):
        return Key(0, Quality.MAJOR, 0.0)
    for quality, profile in ((Quality.MAJOR, KK_MAJOR), (Quality.MINOR, KK_MINOR)):
        for root in range(12):
            r = float(np.corrcoef(global_chroma, np.roll(profile, root))[0, 1])
            if r > best.confidence:
                best = Key(root, quality, r)
    return best


def diatonic_states(key: Key) -> set[int]:
    """Major/minor triads of the key; minor keys also get the harmonic-minor major V."""
    r = key.root
    if key.quality == Quality.MAJOR:
        chords = [(0, Quality.MAJOR), (2, Quality.MINOR), (4, Quality.MINOR),
                  (5, Quality.MAJOR), (7, Quality.MAJOR), (9, Quality.MINOR)]
    else:
        chords = [(0, Quality.MINOR), (3, Quality.MAJOR), (5, Quality.MINOR),
                  (7, Quality.MINOR), (7, Quality.MAJOR), (8, Quality.MAJOR),
                  (10, Quality.MAJOR)]
    return {chord_state(r + i, q) for i, q in chords}


def bass_bonus(bass: np.ndarray) -> np.ndarray:
    """(25, T): each chord's bass chroma at its root, less the chords' average, so the bass
    moves chords against each other but not against N (0)."""
    roots = np.arange(N_STATE) % 12
    out = np.zeros((N_STATES, bass.shape[1]))
    out[:N_STATE] = bass[roots] - bass[roots].mean(axis=0, keepdims=True)
    return out


def emissions(
    sim: np.ndarray,
    quiet: np.ndarray,
    key: Key | None,
    cfg: DecodeConfig,
    bass: np.ndarray | None = None,
) -> np.ndarray:
    """(25, T) per-step state probabilities, columns summing to 1.

    `quiet` marks steps with too little energy to judge; they are forced to N.
    """
    if bass is not None and cfg.bass_weight:
        sim = sim + cfg.bass_weight * bass_bonus(bass)
    logits = sim / cfg.temperature
    p = np.exp(logits - logits.max(axis=0, keepdims=True))
    if key is not None:
        weights = np.full(N_STATES, cfg.non_diatonic)
        weights[list(diatonic_states(key))] = cfg.key_boost
        weights[N_STATE] = 1.0
        p *= weights[:, None]
    p[:, quiet] = 1e-6
    p[N_STATE, quiet] = 1.0
    return p / p.sum(axis=0, keepdims=True)


def viterbi(prob: np.ndarray, self_transition: float) -> np.ndarray:
    """Most likely state per beat under a uniform-switch, sticky-self transition model."""
    trans = librosa.sequence.transition_loop(N_STATES, self_transition)
    return librosa.sequence.viterbi(prob, trans).astype(int)


def segments_from_path(
    path: np.ndarray, prob: np.ndarray, bounds: np.ndarray
) -> list[Segment]:
    """One segment per beat: [bounds[i], bounds[i+1]) labelled path[i]."""
    return [
        Segment(float(bounds[i]), float(bounds[i + 1]), int(s), float(prob[s, i]))
        for i, s in enumerate(path)
    ]


def merge_segments(segments: list[Segment], min_duration: float) -> list[Segment]:
    """Join consecutive equal chords, then absorb segments shorter than `min_duration`.

    A short segment is absorbed into the previous one (the next one if it is first);
    neighbours that end up equal are joined again. Confidence is duration-weighted.
    """

    def join(segs: list[Segment]) -> list[Segment]:
        out: list[Segment] = []
        for s in segs:
            if out and out[-1].state == s.state:
                prev = out[-1]
                total = prev.duration + s.duration
                conf = (
                    (prev.confidence * prev.duration + s.confidence * s.duration) / total
                    if total > 0
                    else prev.confidence
                )
                out[-1] = Segment(prev.start_sec, s.end_sec, prev.state, conf)
            else:
                out.append(Segment(s.start_sec, s.end_sec, s.state, s.confidence))
        return out

    segs = join(segments)
    while len(segs) > 1:
        # Shortest first, so a run of short segments collapses predictably.
        i = min(range(len(segs)), key=lambda k: segs[k].duration)
        if segs[i].duration >= min_duration:
            break
        short = segs.pop(i)
        if i > 0:
            prev = segs[i - 1]
            segs[i - 1] = Segment(prev.start_sec, short.end_sec, prev.state, prev.confidence)
        else:
            nxt = segs[0]
            segs[0] = Segment(short.start_sec, nxt.end_sec, nxt.state, nxt.confidence)
        segs = join(segs)
    return segs


def decode(
    chroma: np.ndarray,
    quiet: np.ndarray,
    bounds: np.ndarray,
    key: Key | None,
    cfg: DecodeConfig,
    min_duration: float,
    bass: np.ndarray | None = None,
    steps_per_beat: int = 1,
) -> list[Segment]:
    """Step chroma (12, T) with T+1 time bounds -> merged chord segments."""
    if chroma.shape[1] == 0:
        return []
    prob = emissions(similarities(chroma, cfg.n_weight), quiet, key, cfg, bass)
    path = viterbi(prob, cfg.self_transition ** (1 / steps_per_beat))
    return merge_segments(segments_from_path(path, prob, bounds), min_duration)
