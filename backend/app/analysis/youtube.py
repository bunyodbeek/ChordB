"""YouTube links -> video id, and audio-only downloads with yt-dlp.

The download runs inside an analysis slot (it counts toward the job's timeout).
Personal account cookies are never used: no cookiefile, no cookies-from-browser,
and the Python API reads no yt-dlp config files. YouTube's JS challenges are
solved with the bundled Deno runtime (the `yt-dlp[deno]` extra).
"""

import logging
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from app.analysis import AnalysisError

log = logging.getLogger("chordb.youtube")

_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}
# /shorts/ID, /embed/ID, /live/ID, /v/ID
_PATH = re.compile(r"^/(?:shorts|embed|live|v)/([A-Za-z0-9_-]{11})(?:[/?#]|$)")

# Download error classes (analyses.error_code). Checked in this order: YouTube's
# messages overlap ("Video unavailable. … blocked it in your country").
_CLASSES: list[tuple[str, tuple[str, ...]]] = [
    ("private_or_removed", (
        "private video", "has been removed", "removed by the uploader",
        "account associated with this video has been terminated", "no longer available",
        "members-only", "join this channel",
    )),
    ("blocked", (
        "sign in to confirm", "confirm your age", "age-restricted", "in your country",
        "geo restrict", "not available in your location", "http error 403", "http error 429",
        "too many requests", "copyright",
    )),
    ("not_found", (
        "video unavailable", "this video is unavailable", "incomplete youtube id",
        "not a valid url", "http error 404", "does not exist", "live event will begin",
        "premieres in",
    )),
]
# Failures that mean "downloading from YouTube is broken" (vs. a bad link): these
# count toward the admin alert.
DOWNLOAD_BROKEN = frozenset({"blocked", "unknown"})

MAX_FILESIZE = 200 * 1024 * 1024  # bestaudio of a 10-minute video is ~10 MB


def parse_youtube_id(text: str) -> str | None:
    """The 11-character video id from a youtube.com/watch, youtu.be or shorts link."""
    text = text.strip()
    if _ID.match(text):
        return text
    if "://" not in text:
        text = "https://" + text
    try:
        url = urlparse(text)
    except ValueError:
        return None
    host = (url.hostname or "").lower()
    if url.scheme not in ("http", "https"):
        return None
    candidate = None
    if host in ("youtu.be", "www.youtu.be"):
        candidate = url.path.lstrip("/").split("/")[0]
    elif host in _HOSTS:
        if url.path in ("/watch", "/watch/"):
            candidate = (parse_qs(url.query).get("v") or [""])[0]
        elif m := _PATH.match(url.path):
            candidate = m.group(1)
    return candidate if candidate and _ID.match(candidate) else None


def watch_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def classify(message: str) -> str:
    text = message.lower()
    for code, needles in _CLASSES:
        if any(n in text for n in needles):
            return code
    return "unknown"


class _Logger:
    """Route yt-dlp's output to logging instead of stdout/stderr."""

    def debug(self, msg: str) -> None:
        pass

    def info(self, msg: str) -> None:
        pass

    def warning(self, msg: str) -> None:
        log.warning("yt-dlp: %s", msg)

    def error(self, msg: str) -> None:
        log.info("yt-dlp: %s", msg)  # also raised as DownloadError and classified


def _options(work_dir: Path) -> dict:
    return {
        "format": "bestaudio/best",
        "outtmpl": str(work_dir / "%(id)s.%(ext)s"),  # absolute, so .part files land here too
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "logger": _Logger(),
        "cachedir": False,
        "socket_timeout": 30,
        "retries": 3,
        "fragment_retries": 3,
        "max_filesize": MAX_FILESIZE,
        "overwrites": True,
    }


def download_audio(video_id: str, work_dir: Path, max_duration: float) -> tuple[Path, str | None]:
    """Download the best audio-only stream into work_dir: (file, video title).

    The duration is checked from the metadata before anything is downloaded.
    Raises AnalysisError with blocked | private_or_removed | too_long | not_found | unknown.
    """
    import yt_dlp  # heavy; only the worker's slots load it
    from yt_dlp.utils import DownloadError, ExtractorError

    work_dir.mkdir(parents=True, exist_ok=True)
    try:
        with yt_dlp.YoutubeDL(_options(work_dir)) as ydl:
            info = ydl.extract_info(watch_url(video_id), download=False)
            if info is None:
                raise AnalysisError("unknown", "no metadata")
            if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming"):
                raise AnalysisError(
                    "too_long" if info.get("is_live") else "not_found", "live stream"
                )
            duration = info.get("duration")
            if duration is not None and duration > max_duration:
                raise AnalysisError("too_long", f"{duration}s > {max_duration:.0f}s")
            ydl.process_ie_result(info, download=True)
    except (DownloadError, ExtractorError) as e:
        raise AnalysisError(classify(str(e)), str(e)[:300]) from e

    files = [f for f in work_dir.iterdir() if f.is_file() and not f.name.endswith(".part")]
    if not files:
        # max_filesize skips the download silently.
        raise AnalysisError("unknown", "nothing was downloaded")
    return max(files, key=lambda f: f.stat().st_size), info.get("title")
