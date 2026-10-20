"""Beat-level accuracy against hand-made ground truth, with and without the key prior.

    python -m app.analysis.evaluate [DIR] [--self-transition 0.85] [--key-boost 1.5]

DIR (default: <repo>/analysis_eval) holds one JSON per song, in the song seed format:

    {"title": "...", "audio": "song.mp3", "bpm": 92, "offset_sec": 1.25,
     "beats_per_bar": 4, "sections": [{"title": "Kuplet", "bars": ["Am", "F", "C G", "N"]}]}

- `audio` is relative to the JSON file. Songs whose audio is missing are skipped.
- `offset_sec` is the time of the first beat of the first bar.
- Each bar is one chord, or several separated by spaces that split the bar evenly. "N" = no chord.
- Chords are reduced to major/minor before comparing (7, maj7, aug -> major;
  m7, dim -> minor). sus2/sus4 beats are not scored.

Each ground-truth beat is compared with the predicted chord at its midpoint.
"""

import argparse
import json
import sys
from bisect import bisect_right
from dataclasses import dataclass, replace
from pathlib import Path

from app.analysis.audio import SAMPLE_RATE, AnalysisError, load_audio
from app.analysis.decode import N_STATE, DecodeConfig, Segment, chord_state
from app.analysis.engine import decode_features, extract_features
from chordb_common.models import NotationKind, Quality
from chordb_common.notation import Chord, format_chord, parse_chord

LETTER = NotationKind.LETTER
DEFAULT_DIR = Path(__file__).resolve().parents[3] / "analysis_eval"

_TO_MAJMIN = {
    Quality.MAJOR: Quality.MAJOR, Quality.DOM7: Quality.MAJOR,
    Quality.MAJ7: Quality.MAJOR, Quality.AUG: Quality.MAJOR,
    Quality.MINOR: Quality.MINOR, Quality.MIN7: Quality.MINOR, Quality.DIM: Quality.MINOR,
}


@dataclass(frozen=True)
class GroundTruthBeat:
    start_sec: float
    end_sec: float
    state: int | None  # vocabulary state; None = not scored (sus chords)


def reduce_symbol(symbol: str) -> int | None:
    """Ground-truth chord symbol -> vocabulary state, None when it has no major/minor reading."""
    if symbol == "N":
        return N_STATE
    chord = parse_chord(symbol)
    quality = _TO_MAJMIN.get(chord.quality)
    return None if quality is None else chord_state(chord.root, quality)


def ground_truth_beats(spec: dict) -> list[GroundTruthBeat]:
    beat = 60.0 / spec["bpm"]
    per_bar = spec.get("beats_per_bar", 4)
    out = []
    i = 0
    for section in spec["sections"]:
        for bar in section["bars"]:
            chords = bar.split()
            for k in range(per_bar):
                symbol = chords[min(k * len(chords) // per_bar, len(chords) - 1)]
                t = spec["offset_sec"] + i * beat
                out.append(GroundTruthBeat(t, t + beat, reduce_symbol(symbol)))
                i += 1
    return out


def state_at(segments: list[Segment], t: float) -> int:
    starts = [s.start_sec for s in segments]
    i = bisect_right(starts, t) - 1
    if i < 0 or t >= segments[i].end_sec:
        return N_STATE
    return segments[i].state


def accuracy(segments: list[Segment], truth: list[GroundTruthBeat]) -> float:
    scored = [b for b in truth if b.state is not None]
    if not scored:
        return 0.0
    hits = sum(state_at(segments, (b.start_sec + b.end_sec) / 2) == b.state for b in scored)
    return hits / len(scored)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("dir", nargs="?", type=Path, default=DEFAULT_DIR)
    defaults = DecodeConfig()
    ap.add_argument("--self-transition", type=float, default=defaults.self_transition)
    ap.add_argument("--key-boost", type=float, default=defaults.key_boost)
    ap.add_argument("--non-diatonic", type=float, default=defaults.non_diatonic)
    args = ap.parse_args(argv)

    cfg = replace(
        defaults,
        self_transition=args.self_transition,
        key_boost=args.key_boost,
        non_diatonic=args.non_diatonic,
    )
    files = sorted(args.dir.glob("*.json"))
    if not files:
        print(f"no ground-truth JSON files in {args.dir}")
        return 1

    print(f"{'song':<36} {'key':>5} {'prior':>7} {'no prior':>9}")
    rows: list[tuple[float, float]] = []
    for path in files:
        spec = json.loads(path.read_text(encoding="utf-8"))
        name = spec.get("title", path.stem)[:36]
        audio = path.parent / spec["audio"]
        try:
            features = extract_features(load_audio(audio), SAMPLE_RATE)
        except AnalysisError as e:
            print(f"{name:<36} skipped: {e.code} ({e})")
            continue
        truth = ground_truth_beats(spec)
        with_prior = decode_features(features, cfg)
        without = decode_features(features, cfg.without_key_prior())
        key = with_prior.key
        key_name = "-" if key is None else format_chord(Chord(key.root, key.quality), LETTER)
        a, b = accuracy(with_prior.segments, truth), accuracy(without.segments, truth)
        rows.append((a, b))
        print(f"{name:<36} {key_name:>5} {a:>7.1%} {b:>9.1%}")

    if not rows:
        return 1
    avg_a = sum(r[0] for r in rows) / len(rows)
    avg_b = sum(r[1] for r in rows) / len(rows)
    print(f"{'average (' + str(len(rows)) + ' songs)':<36} {'':>5} {avg_a:>7.1%} {avg_b:>9.1%}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
