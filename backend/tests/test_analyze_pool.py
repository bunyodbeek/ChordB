"""Analysis slots (real child processes) and YouTube link parsing. No database needed."""

import pytest

from app.analysis import AnalysisError
from app.analysis.pool import Slot
from app.analysis.youtube import parse_youtube_id, watch_url

VID = "dQw4w9WgXcQ"


@pytest.mark.parametrize(
    "text",
    [
        f"https://www.youtube.com/watch?v={VID}",
        f"https://youtube.com/watch?v={VID}&t=42s&list=PL123",
        f"https://m.youtube.com/watch?feature=share&v={VID}",
        f"https://music.youtube.com/watch?v={VID}",
        f"https://youtu.be/{VID}",
        f"https://youtu.be/{VID}?si=abcDEF123",
        f"https://www.youtube.com/shorts/{VID}",
        f"https://youtube.com/shorts/{VID}?feature=share",
        f"youtube.com/watch?v={VID}",
        f"  http://youtu.be/{VID}  ",
        f"https://www.youtube.com/embed/{VID}",
        VID,
    ],
)
def test_parse_youtube_id(text):
    assert parse_youtube_id(text) == VID


@pytest.mark.parametrize(
    "text",
    [
        "",
        "hello",
        "https://vimeo.com/123456",
        f"https://notyoutube.com/watch?v={VID}",
        "https://www.youtube.com/watch?v=short",
        "https://www.youtube.com/channel/UC1234567890",
        f"ftp://youtu.be/{VID}",
        "https://youtu.be/",
    ],
)
def test_parse_youtube_id_rejects(text):
    assert parse_youtube_id(text) is None


def test_watch_url():
    assert watch_url(VID) == f"https://www.youtube.com/watch?v={VID}"


@pytest.fixture
def slot():
    s = None

    def make(runner: str) -> Slot:
        nonlocal s
        s = Slot(runner=runner)
        s.start()
        return s

    yield make
    if s is not None:
        s.stop()


def test_slot_runs_jobs_in_one_process(slot):
    s = slot("math:sqrt")
    pid = s.proc.pid
    assert s.run(16, timeout=30) == 4.0
    assert s.run(9, timeout=30) == 3.0
    assert s.proc.pid == pid


def test_slot_reports_job_errors(slot):
    s = slot("math:sqrt")
    with pytest.raises(AnalysisError) as e:
        s.run("not a number", timeout=30)
    assert e.value.code == "unknown"
    assert s.run(4, timeout=30) == 2.0  # the process survives a failed job


def test_slot_kills_a_job_that_overruns(slot):
    s = slot("time:sleep")
    pid = s.proc.pid
    with pytest.raises(AnalysisError) as e:
        s.run(30, timeout=1)
    assert e.value.code == "timeout"
    assert s.proc is None  # killed
    assert s.run(0, timeout=30) is None  # and a fresh process takes the next job
    assert s.proc.pid != pid


def test_slot_survives_a_crashing_job(slot):
    s = slot("os:_exit")
    with pytest.raises(AnalysisError) as e:
        s.run(3, timeout=30)
    assert e.value.code == "crashed"
