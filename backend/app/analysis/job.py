"""What one analysis slot runs (inside its child process). See pool.py."""

from pathlib import Path

import numpy as np

from app.analysis.audio import MAX_DURATION_SEC, SAMPLE_RATE
from app.analysis.engine import analyze_file, analyze_signal
from app.analysis.youtube import download_audio


def warm_up() -> None:
    """Compile librosa's numba kernels and import yt-dlp before the first real job."""
    import yt_dlp  # noqa: F401

    rng = np.random.default_rng(0)
    analyze_signal(0.1 * rng.standard_normal(SAMPLE_RATE * 3).astype(np.float32))


def run_job(job: dict) -> dict:
    """AnalysisResult.to_json(), plus "title" for YouTube videos.

    upload:  {"source": "upload", "media_path": ...}
    youtube: {"source": "youtube", "youtube_id": ..., "work_dir": ...}; the parent
             deletes work_dir afterwards, even if this process is killed.
    """
    if job["source"] == "upload":
        return analyze_file(Path(job["media_path"])).to_json()
    path, title = download_audio(job["youtube_id"], Path(job["work_dir"]), MAX_DURATION_SEC)
    return {**analyze_file(path).to_json(), "title": title}
