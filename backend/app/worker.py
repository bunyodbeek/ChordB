"""Chord-detection worker: `python -m app.worker`. Run exactly one per database.

The queue is the analyses table itself: a job is claimed by flipping one queued row
to running with FOR UPDATE SKIP LOCKED. ANALYZE_CONCURRENCY slots (default 2) run
jobs in parallel, each in its own process, with ANALYZE_TIMEOUT_SEC (default 180)
per job. Media is deleted as soon as its job ends, whatever the outcome.
"""

import asyncio
import contextlib
import logging
import shutil
import signal
import sys
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from chordb_common.config import get_settings
from chordb_common.db import get_sessionmaker
from chordb_common.models import Analysis, AnalysisSource, AnalysisStatus, Quality

from app.alerts import send_admin_alert
from app.analysis import AnalysisError
from app.analysis.jobs import ACTIVE, log_event
from app.analysis.pool import Slot
from app.analysis.youtube import DOWNLOAD_BROKEN

log = logging.getLogger("chordb.worker")

POLL_SEC = 1.0
SWEEP_EVERY_SEC = 600
# Files in MEDIA_DIR this old that no queued/running job points at are leftovers.
ORPHAN_AGE_SEC = 600
# Alert the admins once when this many YouTube downloads fail in a row.
YOUTUBE_FAILURES_ALERT = 3
# YouTube answered properly (the link is just bad): downloading itself works.
_YOUTUBE_OK = frozenset({"private_or_removed", "not_found", "too_long"})

_CLAIM = text("""
    UPDATE analyses SET status = 'running', started_at = now()
    WHERE id = (
        SELECT id FROM analyses WHERE status = 'queued'
        ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
    )
    RETURNING id, user_id, source, youtube_id, media_path, created_at
""")


class Runner(Protocol):
    def run(self, job: Any, timeout: float) -> Any: ...


@dataclass(frozen=True)
class Claimed:
    id: int
    user_id: int
    source: AnalysisSource
    youtube_id: str | None
    media_path: str | None
    created_at: datetime


def delete_media(path: str | Path | None) -> None:
    if not path:
        return
    p = Path(path)
    if p.is_dir():
        shutil.rmtree(p, ignore_errors=True)
    else:
        with contextlib.suppress(OSError):
            p.unlink(missing_ok=True)


class Worker:
    def __init__(
        self,
        sessionmaker: async_sessionmaker[AsyncSession],
        slots: list[Runner],
        *,
        timeout: float,
        media_dir: Path,
        alert: Callable[[str], Awaitable[None]] = send_admin_alert,
    ):
        self.sessionmaker = sessionmaker
        self.free: asyncio.Queue[Runner] = asyncio.Queue()
        for s in slots:
            self.free.put_nowait(s)
        self.timeout = timeout
        self.media_dir = media_dir
        self.alert = alert
        self.tasks: set[asyncio.Task] = set()
        # In memory: a restart starts counting again, which is fine for an alert.
        self.youtube_failures = 0

    def work_dir(self, analysis_id: int) -> Path:
        """Where a YouTube job downloads to; deleted by the parent when the job ends."""
        return self.media_dir / f"yt-{analysis_id}"

    async def track_youtube(self, error_code: str | None, detail: str = "") -> None:
        """Count YouTube downloads failing in a row; alert once when the streak hits the limit."""
        if error_code is None or error_code in _YOUTUBE_OK:
            self.youtube_failures = 0
            return
        if error_code not in DOWNLOAD_BROKEN:
            return  # e.g. decode_failed or timeout: not a download problem
        self.youtube_failures += 1
        if self.youtube_failures == YOUTUBE_FAILURES_ALERT:
            log_event("youtube_alert", failures=self.youtube_failures, error_code=error_code)
            text = (
                f"⚠️ ChordB: YouTube'dan ketma-ket {self.youtube_failures} ta yuklab olish "
                f"muvaffaqiyatsiz tugadi.\nOxirgi xato: {error_code}\n{detail[:300]}"
            )
            try:
                await self.alert(text)
            except Exception:
                log.exception("admin alert failed")

    async def recover(self) -> None:
        """Requeue jobs a previous worker left running; fail uploads whose file is gone."""
        async with self.sessionmaker() as session:
            rows = (
                await session.scalars(
                    select(Analysis).where(Analysis.status == AnalysisStatus.RUNNING)
                )
            ).all()
            for a in rows:
                if a.source == AnalysisSource.UPLOAD and not (
                    a.media_path and Path(a.media_path).is_file()
                ):
                    a.status, a.error_code = AnalysisStatus.FAILED, "interrupted"
                    a.media_path, a.finished_at = None, datetime.now(UTC)
                    log_event("analyze_failed", analysis_id=a.id, user_id=a.user_id,
                              source=a.source.value, error_code="interrupted")
                else:
                    a.status, a.started_at = AnalysisStatus.QUEUED, None
                    log.info("requeued analysis %s", a.id)
            await session.commit()

    async def claim(self) -> Claimed | None:
        async with self.sessionmaker() as session:
            row = (await session.execute(_CLAIM)).first()
            await session.commit()
        if row is None:
            return None
        return Claimed(
            id=row.id,
            user_id=row.user_id,
            source=AnalysisSource(row.source),
            youtube_id=row.youtube_id,
            media_path=row.media_path,
            created_at=row.created_at,
        )

    async def process(self, job: Claimed, slot: Runner) -> None:
        started = time.monotonic()
        wait_ms = int((datetime.now(UTC) - job.created_at).total_seconds() * 1000)
        youtube = job.source == AnalysisSource.YOUTUBE
        work_dir = self.work_dir(job.id) if youtube else None
        payload = {"source": job.source.value, "media_path": job.media_path,
                   "youtube_id": job.youtube_id,
                   "work_dir": str(work_dir) if work_dir else None}
        common = {"analysis_id": job.id, "user_id": job.user_id, "source": job.source.value}
        try:
            try:
                result = await asyncio.to_thread(slot.run, payload, self.timeout)
            except AnalysisError as e:
                await self._finish(job.id, status=AnalysisStatus.FAILED, error_code=e.code)
                log_event("analyze_failed", **common, error_code=e.code,
                          ms=int((time.monotonic() - started) * 1000), detail=repr(str(e)[:200]))
                if youtube:
                    await self.track_youtube(e.code, str(e))
                return
            except Exception:
                log.exception("analysis %s failed", job.id)
                await self._finish(job.id, status=AnalysisStatus.FAILED, error_code="unknown")
                log_event("analyze_failed", **common, error_code="unknown")
                return
            key = result.get("key")
            extra = {"title": result["title"][:255]} if result.get("title") else {}
            await self._finish(
                job.id,
                status=AnalysisStatus.DONE,
                key_root=key["root"] if key else None,
                key_quality=Quality(key["quality"]) if key else None,
                bpm=result["bpm"],
                duration_sec=result["duration_sec"],
                beats=result["beats"],
                events=result["events"],
                engine_version=result["engine_version"],
                **extra,
            )
            log_event("analyze_done", **common, ms=int((time.monotonic() - started) * 1000),
                      wait_ms=wait_ms, events=len(result["events"]), bpm=result["bpm"])
            if youtube:
                await self.track_youtube(None)
        finally:
            delete_media(job.media_path)
            delete_media(work_dir)
            self.free.put_nowait(slot)

    async def _finish(self, analysis_id: int, **values: Any) -> None:
        async with self.sessionmaker() as session:
            await session.execute(
                update(Analysis)
                .where(Analysis.id == analysis_id)
                .values(media_path=None, finished_at=datetime.now(UTC), **values)
            )
            await session.commit()

    async def sweep(self) -> None:
        """Delete stray media: files from a crashed API request or a lost job."""
        if not self.media_dir.is_dir():
            return
        async with self.sessionmaker() as session:
            active = (
                await session.execute(
                    select(Analysis.id, Analysis.media_path).where(Analysis.status.in_(ACTIVE))
                )
            ).all()
        keep = {str(p) for _, p in active if p} | {str(self.work_dir(i)) for i, _ in active}
        cutoff = time.time() - ORPHAN_AGE_SEC
        for f in self.media_dir.iterdir():
            with contextlib.suppress(OSError):
                if str(f) not in keep and f.stat().st_mtime < cutoff:
                    delete_media(f)
                    log.info("deleted stray media %s", f.name)

    async def run_once(self) -> bool:
        """Claim one job and run it to the end (tests). False when the queue is empty."""
        slot = await self.free.get()
        job = await self.claim()
        if job is None:
            self.free.put_nowait(slot)
            return False
        await self.process(job, slot)
        return True

    async def run(self, stop: asyncio.Event) -> None:
        await self.recover()
        await self.sweep()
        last_sweep = time.monotonic()
        while not stop.is_set():
            try:
                slot = await asyncio.wait_for(self.free.get(), POLL_SEC)
            except TimeoutError:
                continue
            try:
                job = await self.claim()
            except Exception:
                log.exception("claim failed")
                self.free.put_nowait(slot)
                await _sleep_or_stop(stop, 5)
                continue
            if job is None:
                self.free.put_nowait(slot)
                if time.monotonic() - last_sweep > SWEEP_EVERY_SEC:
                    with contextlib.suppress(Exception):
                        await self.sweep()
                    last_sweep = time.monotonic()
                await _sleep_or_stop(stop, POLL_SEC)
                continue
            task = asyncio.create_task(self.process(job, slot))
            self.tasks.add(task)
            task.add_done_callback(self.tasks.discard)
        # Jobs still running are requeued by the next worker's recover().


async def _sleep_or_stop(stop: asyncio.Event, sec: float) -> None:
    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(stop.wait(), sec)


async def _main() -> None:
    settings = get_settings()
    media_dir = settings.media_path
    media_dir.mkdir(parents=True, exist_ok=True)
    n = settings.analyze_concurrency
    log.info("starting %d analysis slots (timeout %ss, media %s)",
             n, settings.analyze_timeout_sec, media_dir)
    slots = [Slot(warm_up="app.analysis.job:warm_up") for _ in range(n)]
    await asyncio.gather(*(asyncio.to_thread(s.start) for s in slots))
    log.info("worker ready")

    stop = asyncio.Event()
    if sys.platform != "win32":
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, stop.set)
    worker = Worker(get_sessionmaker(), list(slots),
                    timeout=settings.analyze_timeout_sec, media_dir=media_dir)
    try:
        await worker.run(stop)
    finally:
        for s in slots:
            s.stop()
        log.info("worker stopped")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(_main())


if __name__ == "__main__":
    main()
