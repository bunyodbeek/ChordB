"""yt-dlp download wrapper (yt-dlp faked) and the admin alert sender. No database needed.

Set CHORDB_NETWORK_TESTS=1 to also download a real (19 s) public video.
"""

import json
import logging
import os
import shutil

import httpx
import pytest
import yt_dlp
from yt_dlp.utils import DownloadError

from chordb_common.config import get_settings

from app import alerts
from app.analysis import AnalysisError
from app.analysis.youtube import classify, download_audio

ID = "jNQXAC9IVRw"


@pytest.mark.parametrize(
    ("message", "code"),
    [
        ("ERROR: [youtube] xxxxxxxxxxx: This video is unavailable", "not_found"),
        ("ERROR: [youtube] x: Video unavailable", "not_found"),
        ("ERROR: [youtube] x: Incomplete YouTube ID abc", "not_found"),
        ("ERROR: [youtube] x: Private video. Sign in if you have been granted access",
         "private_or_removed"),
        ("ERROR: [youtube] x: Video unavailable. This video has been removed by the uploader",
         "private_or_removed"),
        ("ERROR: [youtube] x: This video is no longer available due to a copyright claim",
         "private_or_removed"),
        ("ERROR: [youtube] x: Join this channel to get access to members-only content",
         "private_or_removed"),
        ("ERROR: [youtube] x: Sign in to confirm you’re not a bot. Use --cookies", "blocked"),
        ("ERROR: [youtube] x: Sign in to confirm your age", "blocked"),
        ("ERROR: [youtube] x: Video unavailable. The uploader has not made this video available "
         "in your country", "blocked"),
        ("ERROR: unable to download video data: HTTP Error 403: Forbidden", "blocked"),
        ("ERROR: [youtube] x: HTTP Error 429: Too Many Requests", "blocked"),
        ("ERROR: [youtube] x: Requested format is not available", "unknown"),
        ("ERROR: something new and strange", "unknown"),
    ],
)
def test_classify(message, code):
    assert classify(message) == code


class FakeYDL:
    """Stands in for yt_dlp.YoutubeDL; records whether a download happened."""

    info: dict = {}
    error: Exception | None = None
    downloads: list = []

    def __init__(self, opts):
        self.opts = opts
        # Never any account cookies.
        assert not {"cookiefile", "cookiesfrombrowser", "username", "password"} & set(opts)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def extract_info(self, url, download):
        assert url == f"https://www.youtube.com/watch?v={ID}" and download is False
        if self.error:
            raise self.error
        return self.info

    def process_ie_result(self, info, download):
        FakeYDL.downloads.append(info)
        home = os.path.dirname(self.opts["outtmpl"])
        with open(os.path.join(home, f"{ID}.webm"), "wb") as f:
            f.write(b"audio bytes")
        with open(os.path.join(home, f"{ID}.webm.part"), "wb") as f:
            f.write(b"leftover partial file, much longer than the real one")


@pytest.fixture
def ydl(monkeypatch):
    FakeYDL.info, FakeYDL.error, FakeYDL.downloads = {}, None, []
    monkeypatch.setattr(yt_dlp, "YoutubeDL", FakeYDL)
    return FakeYDL


def test_download_ok(ydl, tmp_path):
    ydl.info = {"id": ID, "title": "Me at the zoo", "duration": 19}
    path, title = download_audio(ID, tmp_path / "w", 600)
    assert path.name == f"{ID}.webm" and title == "Me at the zoo"  # not the .part file
    assert len(ydl.downloads) == 1


@pytest.mark.parametrize(
    ("info", "code"),
    [
        ({"duration": 601}, "too_long"),
        ({"duration": None, "is_live": True}, "too_long"),
        ({"live_status": "is_upcoming"}, "not_found"),
    ],
)
def test_download_checks_metadata_first(ydl, tmp_path, info, code):
    ydl.info = {"id": ID, "title": "t", **info}
    with pytest.raises(AnalysisError) as e:
        download_audio(ID, tmp_path / "w", 600)
    assert e.value.code == code
    assert ydl.downloads == []  # nothing was downloaded


def test_download_errors_are_classified(ydl, tmp_path):
    ydl.error = DownloadError("ERROR: [youtube] x: Sign in to confirm you’re not a bot")
    with pytest.raises(AnalysisError) as e:
        download_audio(ID, tmp_path / "w", 600)
    assert e.value.code == "blocked"


@pytest.mark.skipif(os.environ.get("CHORDB_NETWORK_TESTS") != "1", reason="network test")
def test_real_download(tmp_path):
    path, title = download_audio(ID, tmp_path / "w", 600)
    assert title == "Me at the zoo" and path.stat().st_size > 50_000
    with pytest.raises(AnalysisError) as e:
        download_audio("xxxxxxxxxxx", tmp_path / "w2", 600)
    assert e.value.code == "not_found"
    if shutil.which("ffmpeg"):
        from app.analysis.engine import analyze_file

        assert analyze_file(path).duration_sec == pytest.approx(19, abs=1)


# --- admin alerts -----------------------------------------------------------------------------


@pytest.fixture
def telegram(monkeypatch):
    sent: list[tuple[str, dict]] = []
    status = {"code": 200}

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append((request.url.path, json.loads(request.content)))
        return httpx.Response(status["code"], json={"ok": status["code"] == 200})

    real = httpx.AsyncClient
    monkeypatch.setattr(
        alerts.httpx, "AsyncClient",
        lambda **kw: real(transport=httpx.MockTransport(handler), **kw),
    )
    return sent, status


async def test_alert_goes_to_every_admin(telegram, monkeypatch):
    sent, _ = telegram
    monkeypatch.setattr(get_settings(), "admin_ids", "7, 8")
    await alerts.send_admin_alert("salom")
    assert sorted(b["chat_id"] for _, b in sent) == [7, 8]
    assert all(path.endswith("/sendMessage") and b["text"] == "salom" for path, b in sent)


async def test_alert_failures_never_leak_the_token(telegram, monkeypatch, caplog):
    _, status = telegram
    status["code"] = 403  # the admin never pressed /start
    monkeypatch.setattr(get_settings(), "admin_ids", "7")
    with caplog.at_level(logging.INFO, logger="chordb"):
        await alerts.send_admin_alert("x")
    assert "HTTP 403" in caplog.text
    assert get_settings().bot_token not in caplog.text


async def test_no_admins_no_alert(telegram, monkeypatch):
    sent, _ = telegram
    monkeypatch.setattr(get_settings(), "admin_ids", "")
    await alerts.send_admin_alert("x")
    assert sent == []
