"""Synthetic test songs: strummed triads on every beat plus a kick, with exact ground truth.

    python -m app.analysis.synth ../analysis_eval      # writes synthetic_am.{wav,json}

Used by the unit tests and as a smoke test for the evaluation; real recordings
are what the accuracy numbers should be judged on.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

from app.analysis.audio import SAMPLE_RATE
from chordb_common.models import Quality
from chordb_common.notation import parse_chord

DEMO = {
    "title": "Synthetic Am-F-C-G",
    "audio": "synthetic_am.wav",
    "bpm": 96,
    "offset_sec": 0.5,
    "beats_per_bar": 4,
    "sections": [
        {"title": "Kirish", "bars": ["Am", "F", "C", "G"]},
        {"title": "Kuplet", "bars": ["Am", "F", "C", "G", "Am", "F", "G", "E"]},
        {"title": "Naqarot", "bars": ["F", "G", "Am", "Am", "F", "G", "C", "E"]},
        {"title": "Yakun", "bars": ["Am", "N"]},
    ],
}


def _freq(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def _pluck(midi: int, length: int, sr: int) -> np.ndarray:
    t = np.arange(length) / sr
    tone = sum(np.sin(2 * np.pi * _freq(midi) * h * t) / h**1.5 for h in range(1, 6))
    return tone * np.exp(-3.0 * t)


def _kick(length: int, sr: int) -> np.ndarray:
    t = np.arange(length) / sr
    sweep = np.sin(2 * np.pi * (50 + 100 * np.exp(-30 * t)) * t)
    return sweep * np.exp(-25 * t)


def chord_notes(symbol: str) -> list[int]:
    """MIDI notes for a strum: bass root in octave 2-3 plus the triad around middle C."""
    chord = parse_chord(symbol)
    third = 3 if chord.quality in (Quality.MINOR, Quality.MIN7, Quality.DIM) else 4
    base = 48 + chord.root
    return [36 + chord.root, base, base + third, base + 7, base + 12]


def render(spec: dict, sr: int = SAMPLE_RATE, seed: int = 0) -> np.ndarray:
    """Audio for a ground-truth spec (the analysis_eval format)."""
    rng = np.random.default_rng(seed)
    beat = 60.0 / spec["bpm"]
    per_bar = spec.get("beats_per_bar", 4)
    bars = [b for s in spec["sections"] for b in s["bars"]]
    total = spec["offset_sec"] + len(bars) * per_bar * beat + 1.0
    y = np.zeros(int(total * sr))
    hit = int(beat * sr)

    for bar_i, bar in enumerate(bars):
        chords = bar.split()
        for k in range(per_bar):
            start = int((spec["offset_sec"] + (bar_i * per_bar + k) * beat) * sr)
            y[start:start + hit] += 0.5 * _kick(len(y[start:start + hit]), sr)
            symbol = chords[min(k * len(chords) // per_bar, len(chords) - 1)]
            if symbol == "N":
                continue
            for j, note in enumerate(chord_notes(symbol)):
                s = start + j * int(0.012 * sr)  # 12 ms strum
                seg = y[s:s + hit]
                seg += 0.15 * _pluck(note, len(seg), sr)
    y += 0.003 * rng.standard_normal(len(y))
    return (y / np.abs(y).max() * 0.8).astype(np.float32)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("out_dir", type=Path)
    args = ap.parse_args(argv)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    sf.write(args.out_dir / DEMO["audio"], render(DEMO), SAMPLE_RATE)
    (args.out_dir / "synthetic_am.json").write_text(json.dumps(DEMO, indent=2), encoding="utf-8")
    print(f"wrote {args.out_dir / DEMO['audio']} and synthetic_am.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
