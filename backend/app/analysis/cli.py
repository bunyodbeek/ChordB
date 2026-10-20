"""Analyse one local audio/video file and print key, bpm and the chord timeline.

    python -m app.analysis.cli path/to/file.mp3 [--json] [--no-key-prior] [--notation solfege]
"""

import argparse
import json
import sys
import time

from app.analysis.audio import AnalysisError
from app.analysis.decode import DecodeConfig, state_chord
from app.analysis.engine import analyze_file
from chordb_common.models import NotationKind
from chordb_common.notation import Chord, format_chord


def _time(sec: float) -> str:
    return f"{int(sec // 60)}:{sec % 60:05.2f}"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("path")
    ap.add_argument("--json", action="store_true", help="print the raw result as JSON")
    ap.add_argument("--no-key-prior", action="store_true")
    ap.add_argument("--self-transition", type=float, default=DecodeConfig().self_transition)
    ap.add_argument("--notation", choices=[n.value for n in NotationKind], default="letter")
    args = ap.parse_args(argv)

    cfg = DecodeConfig(self_transition=args.self_transition)
    if args.no_key_prior:
        cfg = cfg.without_key_prior()
    started = time.monotonic()
    try:
        result = analyze_file(args.path, cfg)
    except AnalysisError as e:
        print(f"error: {e.code}: {e}", file=sys.stderr)
        return 2
    elapsed = time.monotonic() - started

    if args.json:
        print(json.dumps(result.to_json(), indent=2))
        return 0

    notation = NotationKind(args.notation)
    key = "?" if result.key is None else format_chord(
        Chord(result.key.root, result.key.quality), notation
    )
    print(f"key      {key}  (r={result.key.confidence:.2f})" if result.key else "key      ?")
    print(f"bpm      {result.bpm:.1f}")
    print(f"duration {_time(result.duration_sec)}  ({len(result.beats)} beats, {elapsed:.1f}s)")
    print()
    for s in result.segments:
        chord = state_chord(s.state)
        name = "N" if chord is None else format_chord(Chord(*chord), notation)
        print(f"{_time(s.start_sec)} - {_time(s.end_sec)}  {name:<14} {s.confidence:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
