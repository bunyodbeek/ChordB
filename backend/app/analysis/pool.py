"""Analysis slots: one long-lived child process per concurrent job.

A child is started once, imports librosa and warms numba up, then runs jobs one at
a time. A job that overruns its timeout gets its child killed and replaced, which a
thread or a ProcessPoolExecutor could not do.
"""

import importlib
import multiprocessing as mp
from multiprocessing.connection import Connection
from typing import Any

from app.analysis import AnalysisError

DEFAULT_RUNNER = "app.analysis.job:run_job"
START_TIMEOUT_SEC = 300  # first librosa import + numba compile on a slow VPS

_ctx = mp.get_context("spawn")  # same behaviour on Windows and Linux; no forked DB state


def _resolve(spec: str):
    module, name = spec.split(":")
    return getattr(importlib.import_module(module), name)


def _child_main(conn: Connection, runner: str, warm_up: str | None) -> None:
    if warm_up:
        _resolve(warm_up)()
    run = _resolve(runner)
    conn.send(("ready",))
    while True:
        try:
            job = conn.recv()
        except (EOFError, OSError):
            return  # parent went away
        try:
            conn.send(("ok", run(job)))
        except AnalysisError as e:
            conn.send(("error", e.code, str(e)[:500]))
        except Exception as e:  # noqa: BLE001 - every failure must reach the parent
            conn.send(("error", "unknown", repr(e)[:500]))


class Slot:
    """Blocking API; the worker calls it from a thread."""

    def __init__(self, runner: str = DEFAULT_RUNNER, warm_up: str | None = None):
        self.runner = runner
        self.warm_up = warm_up
        self.proc: Any = None
        self.conn: Connection | None = None

    def start(self) -> None:
        parent, child = _ctx.Pipe()
        self.proc = _ctx.Process(
            target=_child_main, args=(child, self.runner, self.warm_up), daemon=True
        )
        self.proc.start()
        child.close()
        self.conn = parent
        if not parent.poll(START_TIMEOUT_SEC):
            self.stop()
            raise RuntimeError("analysis process did not start")
        parent.recv()

    def stop(self) -> None:
        if self.proc is not None and self.proc.is_alive():
            self.proc.kill()
        if self.proc is not None:
            self.proc.join(10)
        if self.conn is not None:
            self.conn.close()
        self.proc = self.conn = None

    def run(self, job: Any, timeout: float) -> Any:
        """Run one job; raise AnalysisError("timeout" | "crashed" | the job's own code)."""
        if self.proc is None or not self.proc.is_alive():
            self.stop()
            self.start()
        assert self.conn is not None
        try:
            self.conn.send(job)
            if not self.conn.poll(timeout):
                self.stop()
                raise AnalysisError("timeout", f"no result after {timeout:.0f}s")
            msg = self.conn.recv()
        except (EOFError, OSError) as e:  # the child died mid-job
            self.stop()
            raise AnalysisError("crashed", repr(e)) from e
        if msg[0] == "ok":
            return msg[1]
        raise AnalysisError(msg[1], msg[2])
