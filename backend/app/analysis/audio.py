"""Any audio/video file -> mono float32 samples at SAMPLE_RATE, through the system ffmpeg."""

import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

from app.analysis import AnalysisError

__all__ = ["MAX_DURATION_SEC", "SAMPLE_RATE", "AnalysisError", "load_audio", "probe_duration"]

SAMPLE_RATE = 22050
MAX_DURATION_SEC = 10 * 60


def _tool(name: str) -> str:
    path = shutil.which(name)
    if path is None:
        raise AnalysisError("ffmpeg_missing", f"{name} not found on PATH")
    return path


def probe_duration(path: Path) -> float | None:
    """Container duration in seconds, or None when ffprobe can't tell."""
    try:
        out = subprocess.run(
            [_tool("ffprobe"), "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, timeout=30, check=True,
        ).stdout.strip()
        return float(out)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, ValueError):
        return None


def load_audio(path: Path, max_duration: float = MAX_DURATION_SEC) -> np.ndarray:
    """Decode to mono SAMPLE_RATE samples. Rejects audio longer than `max_duration`."""
    if not path.is_file():
        raise AnalysisError("not_found", str(path))
    duration = probe_duration(path)
    if duration is not None and duration > max_duration:
        raise AnalysisError("too_long", f"{duration:.0f}s > {max_duration:.0f}s")

    with tempfile.TemporaryDirectory(prefix="chordb-") as tmp:
        wav = Path(tmp) / "audio.wav"
        # Decode one second past the limit so a file ffprobe couldn't measure is still caught.
        result = subprocess.run(
            [_tool("ffmpeg"), "-nostdin", "-v", "error", "-i", str(path),
             "-t", str(max_duration + 1), "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE),
             "-f", "wav", str(wav)],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0 or not wav.is_file():
            raise AnalysisError("decode_failed", result.stderr.strip()[-500:])
        y, _ = sf.read(wav, dtype="float32")

    if y.ndim > 1:
        y = y.mean(axis=1)
    if len(y) == 0:
        raise AnalysisError("decode_failed", "no audio stream")
    if len(y) > max_duration * SAMPLE_RATE:
        raise AnalysisError("too_long", f"> {max_duration:.0f}s")
    return y
