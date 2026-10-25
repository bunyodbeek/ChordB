"""Audio -> key, bpm, beats and chord timeline. Source-agnostic: works on any local file.

Two steps, so the evaluation can decode the same features with different settings:
extract_features() does the heavy DSP once; decode_features() is cheap.
"""

import warnings
from dataclasses import dataclass, field
from pathlib import Path

import librosa
import numpy as np

from app.analysis import ENGINE_VERSION
from app.analysis.audio import SAMPLE_RATE, AnalysisError, load_audio
from app.analysis.decode import DecodeConfig, Key, Segment, decode, estimate_key, state_chord
from app.analysis.tuning import TuningAdvice, advise

HOP = 512
# Median-filter size for HPSS; 17 is ~40% faster than librosa's 31 at a similar split.
HPSS_KERNEL = 17
# Chroma from C2 (65 Hz) over 6 octaves: guitar and bass, without kick-drum sub-bass.
CHROMA_FMIN = 65.41
CHROMA_OCTAVES = 6
BINS_PER_OCTAVE = 36
# The bass chroma: the lowest two octaves, C2-B3 (65-247 Hz). Its strongest note is
# usually the chord's root, which tells Am from C where the upper notes are shared.
BASS_OCTAVES = 2
# Chords are judged per half beat, so a change pushed to the "&" lands on it instead of
# on the next beat, half a beat late.
SUBDIVISIONS = 2
# A frame quieter than this many dB below the loudest one carries no harmony.
QUIET_DB = 40.0
# The onset envelope peaks a little after a strum's attack, so tracked beats come out
# ~35 ms late (measured on synthetic songs, the same on every one): moved back this many
# frames (23 ms each).
ONSET_LAG_FRAMES = 1
# Used when the beat tracker finds (almost) nothing, e.g. free-tempo playing.
FALLBACK_STEP_SEC = 0.5


@dataclass
class Features:
    duration_sec: float
    bpm: float
    beats: np.ndarray  # beat times (s)
    bounds: np.ndarray  # T+1 step boundaries (s): 0, beats and half beats..., duration
    chroma: np.ndarray  # (12, T) chroma per step, each column max-normalised
    quiet: np.ndarray  # (T,) steps with no usable harmonic energy
    global_chroma: np.ndarray  # (12,) for key estimation
    tuning_cents: float = 0.0  # estimated deviation from A440, -50..+50
    # (12, T) bass chroma per step; a column's max is how sure the bass is (0..1): its
    # loudness against the song's typical bass. None: decode without it.
    bass: np.ndarray | None = None
    steps_per_beat: int = 1

    @property
    def beat_period(self) -> float:
        if len(self.beats) >= 2:
            return float(np.median(np.diff(self.beats)))
        return 60.0 / self.bpm if self.bpm > 0 else FALLBACK_STEP_SEC


@dataclass
class AnalysisResult:
    key: Key | None
    bpm: float
    beats: list[float]
    duration_sec: float
    segments: list[Segment]
    tuning_cents: float = 0.0
    advice: TuningAdvice = field(default_factory=lambda: TuningAdvice(None, 0, {}))
    engine_version: str = ENGINE_VERSION
    config: DecodeConfig = field(default_factory=DecodeConfig)

    def events(self) -> list[dict]:
        """[{start_sec, end_sec, chord: {root, quality} | None, confidence}]; None = no chord."""
        out = []
        for s in self.segments:
            chord = state_chord(s.state)
            out.append({
                "start_sec": round(s.start_sec, 3),
                "end_sec": round(s.end_sec, 3),
                "chord": None if chord is None else {"root": chord[0], "quality": chord[1].value},
                "confidence": round(s.confidence, 3),
            })
        return out

    def to_json(self) -> dict:
        return {
            "engine_version": self.engine_version,
            "key": None if self.key is None else {
                "root": self.key.root,
                "quality": self.key.quality.value,
                "confidence": round(self.key.confidence, 3),
            },
            "bpm": round(self.bpm, 1),
            "duration_sec": round(self.duration_sec, 3),
            "beats": [round(b, 3) for b in self.beats],
            "events": self.events(),
            "tuning_offset_cents": round(self.tuning_cents, 1),
            # Events are sounding pitch. In alt_tuning the shapes are each chord moved
            # up by -shift semitones (Fm in Eb standard is played as an F#m shape).
            "alt_tuning": self.advice.alt_tuning,
            "suggested_capo": self.advice.suggested_capo,
        }


def fill_gaps(beat_frames: np.ndarray, n_frames: int) -> np.ndarray:
    """Pad stretches with no tracked beats (intro, breaks, outro) at the median beat period.

    The tracker trims weak beats at the edges; without this, a whole outro would be
    one segment carrying the last chord.
    """
    period = float(np.median(np.diff(beat_frames)))
    edges = np.concatenate([[0], beat_frames, [n_frames]])
    out = []
    for i, (a, b) in enumerate(zip(edges[:-1], edges[1:])):
        if i > 0:
            out.append(a)
        if b - a > 1.5 * period:
            k = round((b - a) / period)
            # Leading gap: count back from the first beat; others: forward from the beat.
            filler = b - period * np.arange(1, k) if i == 0 else a + period * np.arange(1, k)
            out.extend(int(round(f)) for f in filler)
    return np.unique(np.array([f for f in out if 0 < f < n_frames], dtype=int))


def step_bounds(beat_frames: np.ndarray, n_frames: int, subdivisions: int) -> np.ndarray:
    """Frame boundaries: 0, each beat split into `subdivisions` equal steps, n_frames."""
    edges = np.concatenate([[0], beat_frames, [n_frames]])
    splits = [edges[:-1] + (edges[1:] - edges[:-1]) * k // subdivisions for k in range(1, subdivisions)]
    return np.unique(np.concatenate([edges, *splits])).astype(int)


def extract_features(
    y: np.ndarray,
    sr: int = SAMPLE_RATE,
    subdivisions: int = SUBDIVISIONS,
    onset_lag: int = ONSET_LAG_FRAMES,
) -> Features:
    duration = len(y) / sr
    if duration < 1.0:
        raise AnalysisError("too_short", f"{duration:.2f}s")

    # HPSS on one STFT: the harmonic part goes back to audio for the CQT chroma, the
    # percussive part only feeds the onset envelope, so it never needs an inverse STFT.
    stft = librosa.stft(y, hop_length=HOP)
    harm, perc = librosa.decompose.hpss(stft, kernel_size=HPSS_KERNEL)
    y_harm = librosa.istft(harm, hop_length=HOP, length=len(y))

    perc_mel = librosa.feature.melspectrogram(S=np.abs(perc) ** 2, sr=sr)
    onset_env = librosa.onset.onset_strength(S=librosa.power_to_db(perc_mel), sr=sr)
    tempo, beat_frames = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr, hop_length=HOP)
    bpm = float(np.atleast_1d(tempo)[0])

    with warnings.catch_warnings():
        # Tuning estimation warns on silent input; the quiet mask handles that case.
        warnings.simplefilter("ignore", UserWarning)
        # Sub-semitone detuning (a guitar tuned 30 cents flat, a slightly sped-up
        # upload): estimated once on the harmonic part, in fractions of a semitone,
        # and corrected for in the CQT. Whole-semitone shifts are tuning.py's job.
        tuning = float(librosa.estimate_tuning(y=y_harm, sr=sr))
        if not np.isfinite(tuning):
            tuning = 0.0
        # One constant-Q transform for both chromas.
        cqt = np.abs(librosa.cqt(
            y_harm, sr=sr, hop_length=HOP, fmin=CHROMA_FMIN, tuning=tuning,
            n_bins=CHROMA_OCTAVES * BINS_PER_OCTAVE, bins_per_octave=BINS_PER_OCTAVE,
        ))
    chroma = librosa.feature.chroma_cqt(C=cqt, bins_per_octave=BINS_PER_OCTAVE, fmin=CHROMA_FMIN)
    bass_chroma = librosa.feature.chroma_cqt(
        C=cqt[: BASS_OCTAVES * BINS_PER_OCTAVE], bins_per_octave=BINS_PER_OCTAVE,
        fmin=CHROMA_FMIN, norm=None,
    )
    rms = librosa.feature.rms(y=y_harm, hop_length=HOP)[0]
    n = min(chroma.shape[1], len(rms))
    chroma, bass_chroma, rms = chroma[:, :n], bass_chroma[:, :n], rms[:n]
    loud = rms > max(float(rms.max()) * 10 ** (-QUIET_DB / 20), 1e-4)

    beat_frames = beat_frames - onset_lag
    beat_frames = np.unique(beat_frames[(beat_frames > 0) & (beat_frames < n)])
    if len(beat_frames) < 4:
        step = max(1, round(FALLBACK_STEP_SEC * sr / HOP))
        beat_frames = np.arange(step, n, step)
        bpm = 60.0 / FALLBACK_STEP_SEC if bpm <= 0 else bpm
    else:
        beat_frames = fill_gaps(beat_frames, n)
    frame_bounds = step_bounds(beat_frames, n, subdivisions)

    steps = len(frame_bounds) - 1
    step_chroma = np.zeros((12, steps))
    step_bass = np.zeros((12, steps))
    quiet = np.ones(steps, dtype=bool)
    for i, (a, b) in enumerate(zip(frame_bounds[:-1], frame_bounds[1:])):
        frames = loud[a:b]
        if frames.any():
            step_chroma[:, i] = np.median(chroma[:, a:b][:, frames], axis=1)
            step_bass[:, i] = np.median(bass_chroma[:, a:b][:, frames], axis=1)
            quiet[i] = False
    peak = step_chroma.max(axis=0, keepdims=True)
    step_chroma = np.divide(step_chroma, peak, out=np.zeros_like(step_chroma), where=peak > 0)
    quiet |= peak[0] <= 0

    beats = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP)
    bounds = np.concatenate([[0.0], librosa.frames_to_time(frame_bounds[1:-1], sr=sr, hop_length=HOP), [duration]])
    return Features(
        duration_sec=duration,
        bpm=bpm,
        beats=beats,
        bounds=bounds,
        chroma=step_chroma,
        quiet=quiet,
        global_chroma=chroma[:, loud].sum(axis=1) if loud.any() else np.zeros(12),
        tuning_cents=tuning * 100,
        bass=bass_strength(step_bass, quiet),
        steps_per_beat=subdivisions,
    )


def bass_strength(bass: np.ndarray, quiet: np.ndarray) -> np.ndarray:
    """Each step's bass chroma scaled so its max is the step's bass loudness against the
    song's median one, capped at 1: a step with hardly any bass hardly counts."""
    peak = bass.max(axis=0)
    typical = float(np.median(peak[~quiet & (peak > 0)])) if np.any(~quiet & (peak > 0)) else 0.0
    if typical <= 0:
        return np.zeros_like(bass)
    strength = np.minimum(1.0, peak / typical)
    return np.divide(bass, peak, out=np.zeros_like(bass), where=peak > 0) * strength


def decode_features(features: Features, cfg: DecodeConfig = DecodeConfig()) -> AnalysisResult:
    key = estimate_key(features.global_chroma) if features.global_chroma.any() else None
    segments = decode(
        features.chroma, features.quiet, features.bounds, key, cfg,
        min_duration=features.beat_period * 0.99,
        bass=features.bass,
        steps_per_beat=features.steps_per_beat,
    )
    return AnalysisResult(
        key=key,
        bpm=features.bpm,
        beats=[float(b) for b in features.beats],
        duration_sec=features.duration_sec,
        segments=segments,
        tuning_cents=features.tuning_cents,
        advice=advise(segments),
        config=cfg,
    )


def analyze_signal(
    y: np.ndarray, sr: int = SAMPLE_RATE, cfg: DecodeConfig = DecodeConfig()
) -> AnalysisResult:
    return decode_features(extract_features(y, sr), cfg)


def analyze_file(path: str | Path, cfg: DecodeConfig = DecodeConfig()) -> AnalysisResult:
    return analyze_signal(load_audio(Path(path)), SAMPLE_RATE, cfg)
