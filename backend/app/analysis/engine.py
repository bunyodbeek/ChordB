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

HOP = 512
# Median-filter size for HPSS; 17 is ~40% faster than librosa's 31 at a similar split.
HPSS_KERNEL = 17
# Chroma from C2 (65 Hz) over 6 octaves: guitar and bass, without kick-drum sub-bass.
CHROMA_FMIN = 65.41
CHROMA_OCTAVES = 6
# A frame quieter than this many dB below the loudest one carries no harmony.
QUIET_DB = 40.0
# Used when the beat tracker finds (almost) nothing, e.g. free-tempo playing.
FALLBACK_STEP_SEC = 0.5


@dataclass
class Features:
    duration_sec: float
    bpm: float
    beats: np.ndarray  # beat times (s)
    bounds: np.ndarray  # T+1 segment boundaries (s): 0, beats..., duration
    chroma: np.ndarray  # (12, T) beat-synchronous chroma, each column max-normalised
    quiet: np.ndarray  # (T,) beats with no usable harmonic energy
    global_chroma: np.ndarray  # (12,) for key estimation

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


def extract_features(y: np.ndarray, sr: int = SAMPLE_RATE) -> Features:
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
        chroma = librosa.feature.chroma_cqt(
            y=y_harm, sr=sr, hop_length=HOP, fmin=CHROMA_FMIN, n_octaves=CHROMA_OCTAVES
        )
    rms = librosa.feature.rms(y=y_harm, hop_length=HOP)[0]
    n = min(chroma.shape[1], len(rms))
    chroma, rms = chroma[:, :n], rms[:n]
    loud = rms > max(float(rms.max()) * 10 ** (-QUIET_DB / 20), 1e-4)

    beat_frames = np.unique(beat_frames[(beat_frames > 0) & (beat_frames < n)])
    if len(beat_frames) < 4:
        step = max(1, round(FALLBACK_STEP_SEC * sr / HOP))
        beat_frames = np.arange(step, n, step)
        bpm = 60.0 / FALLBACK_STEP_SEC if bpm <= 0 else bpm
    else:
        beat_frames = fill_gaps(beat_frames, n)
    frame_bounds = np.concatenate([[0], beat_frames, [n]])

    beat_chroma = np.zeros((12, len(frame_bounds) - 1))
    quiet = np.ones(len(frame_bounds) - 1, dtype=bool)
    for i, (a, b) in enumerate(zip(frame_bounds[:-1], frame_bounds[1:])):
        frames = chroma[:, a:b][:, loud[a:b]]
        if frames.shape[1]:
            beat_chroma[:, i] = np.median(frames, axis=1)
            quiet[i] = False
    peak = beat_chroma.max(axis=0, keepdims=True)
    beat_chroma = np.divide(beat_chroma, peak, out=np.zeros_like(beat_chroma), where=peak > 0)
    quiet |= peak[0] <= 0

    beats = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP)
    bounds = np.concatenate([[0.0], beats, [duration]])
    return Features(
        duration_sec=duration,
        bpm=bpm,
        beats=beats,
        bounds=bounds,
        chroma=beat_chroma,
        quiet=quiet,
        global_chroma=chroma[:, loud].sum(axis=1) if loud.any() else np.zeros(12),
    )


def decode_features(features: Features, cfg: DecodeConfig = DecodeConfig()) -> AnalysisResult:
    key = estimate_key(features.global_chroma) if features.global_chroma.any() else None
    segments = decode(
        features.chroma, features.quiet, features.bounds, key, cfg,
        min_duration=features.beat_period * 0.99,
    )
    return AnalysisResult(
        key=key,
        bpm=features.bpm,
        beats=[float(b) for b in features.beats],
        duration_sec=features.duration_sec,
        segments=segments,
        config=cfg,
    )


def analyze_signal(
    y: np.ndarray, sr: int = SAMPLE_RATE, cfg: DecodeConfig = DecodeConfig()
) -> AnalysisResult:
    return decode_features(extract_features(y, sr), cfg)


def analyze_file(path: str | Path, cfg: DecodeConfig = DecodeConfig()) -> AnalysisResult:
    return analyze_signal(load_audio(Path(path)), SAMPLE_RATE, cfg)
