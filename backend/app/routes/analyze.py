"""Automatic chord detection: queue a file or a YouTube link, poll for the result.

The worker (app/worker.py) does the analysis; this module only validates, deduplicates,
serves cache hits and enforces the free daily limit.
"""

import contextlib
import hashlib
import json
import uuid
from pathlib import Path, PurePath

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import ValidationError
from sqlalchemy import select
from starlette.datastructures import UploadFile

from chordb_common.config import get_settings
from chordb_common.models import Analysis, AnalysisSource, User

from app.analysis.jobs import (
    copy_cached,
    find_cached,
    find_in_flight,
    log_event,
    remaining_today,
)
from app.analysis.youtube import parse_youtube_id, watch_url
from app.deps import CurrentUser, Session
from app.schemas import AnalysisHistoryOut, AnalysisOut, AnalysisSummary, AnalyzeYouTubeIn

router = APIRouter(prefix="/analyze", tags=["analyze"])

HISTORY_LEN = 20
CHUNK = 1024 * 1024
# Gallery files without a usable MIME type are still accepted by extension.
EXTENSIONS = {
    ".mp3", ".m4a", ".aac", ".wav", ".ogg", ".oga", ".opus", ".flac", ".wma", ".amr",
    ".mp4", ".m4v", ".mov", ".webm", ".mkv", ".3gp", ".avi",
}


def _error(code: int, error_code: str, **extra) -> HTTPException:
    return HTTPException(code, {"code": error_code, **extra})


def _accepted_type(filename: str, content_type: str) -> bool:
    mime = content_type.split(";")[0].strip().lower()
    if mime.startswith(("audio/", "video/")):
        return True
    return mime in ("", "application/octet-stream") and PurePath(filename).suffix.lower() in EXTENSIONS


async def _save_upload(file: UploadFile, max_bytes: int) -> tuple[Path, str]:
    """Copy into MEDIA_DIR while hashing; enforce the size limit on the real bytes."""
    media_dir = get_settings().media_path
    media_dir.mkdir(parents=True, exist_ok=True)
    suffix = PurePath(file.filename or "").suffix.lower()
    path = media_dir / f"{uuid.uuid4().hex}{suffix if suffix in EXTENSIONS else ''}"
    digest = hashlib.sha256()
    size = 0
    try:
        with path.open("wb") as out:
            while chunk := await file.read(CHUNK):
                size += len(chunk)
                if size > max_bytes:
                    raise _error(413, "file_too_large", max_mb=max_bytes // (1024 * 1024))
                digest.update(chunk)
                out.write(chunk)
        if size == 0:
            raise _error(422, "empty_file")
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return path, digest.hexdigest()


async def _queue_or_cached(
    session: Session,
    user: User,
    response: Response,
    *,
    source: AnalysisSource,
    source_ref: str,
    title: str | None,
    youtube_id: str | None = None,
    file_hash: str | None = None,
    media_path: Path | None = None,
) -> AnalysisOut:
    """Cache hit (200, free), the user's own in-flight duplicate (202), or a new job (202)."""
    common = {"user_id": user.id, "source": source.value}

    def drop_media() -> None:
        if media_path:
            media_path.unlink(missing_ok=True)

    try:
        if cached := await find_cached(session, youtube_id=youtube_id, file_hash=file_hash):
            drop_media()
            row = copy_cached(cached, user, source_ref=source_ref, title=title)
            session.add(row)
            await session.commit()
            await session.refresh(row)
            log_event("analyze_request", **common, analysis_id=row.id, cache_hit=True)
            log_event("analyze_done", **common, analysis_id=row.id, cache_hit=True,
                      cached_from=cached.id)
            response.status_code = status.HTTP_200_OK
            return AnalysisOut.build(row)

        if dup := await find_in_flight(session, user, youtube_id=youtube_id, file_hash=file_hash):
            drop_media()  # the queued job already has its own copy
            log_event("analyze_request", **common, analysis_id=dup.id, duplicate=True)
            response.status_code = status.HTTP_202_ACCEPTED
            return AnalysisOut.build(dup)

        if (left := await remaining_today(session, user)) is not None and left <= 0:
            log_event("analyze_request", **common, rejected="daily_limit")
            raise _error(429, "daily_limit", limit=get_settings().analyze_free_per_day)

        row = Analysis(
            user_id=user.id,
            source=source,
            source_ref=source_ref,
            title=title,
            youtube_id=youtube_id,
            file_hash=file_hash,
            media_path=str(media_path) if media_path else None,
        )
        session.add(row)
        await session.commit()
    except BaseException:
        drop_media()
        raise
    # Not deleted here on success: the worker owns the file now.
    await session.refresh(row)
    log_event("analyze_request", **common, analysis_id=row.id, cache_hit=False)
    response.status_code = status.HTTP_202_ACCEPTED
    return AnalysisOut.build(row)


@router.post(
    "",
    response_model=AnalysisOut,
    status_code=status.HTTP_202_ACCEPTED,
    responses={
        200: {"description": "Cache hit: the result is already in the body (status=done)"},
        413: {"description": "detail.code = file_too_large"},
        415: {"description": "detail.code = unsupported_type"},
        422: {"description": "detail.code = invalid_url | empty_file | no_file"},
        429: {"description": "detail.code = daily_limit, detail.limit"},
    },
)
async def create_analysis(
    request: Request, response: Response, user: CurrentUser, session: Session
) -> AnalysisOut:
    """multipart/form-data with a `file` field, or JSON `{"youtube_url": "..."}`."""
    content_type = request.headers.get("content-type", "")

    if content_type.startswith("application/json"):
        try:
            body = AnalyzeYouTubeIn.model_validate(json.loads(await request.body()))
        except (ValueError, ValidationError) as e:
            raise _error(422, "invalid_url") from e
        video_id = parse_youtube_id(body.youtube_url)
        if video_id is None:
            raise _error(422, "invalid_url")
        return await _queue_or_cached(
            session, user, response,
            source=AnalysisSource.YOUTUBE, source_ref=watch_url(video_id), title=None,
            youtube_id=video_id,
        )

    if not content_type.startswith("multipart/form-data"):
        raise _error(415, "unsupported_type")

    max_bytes = get_settings().analyze_max_upload_mb * 1024 * 1024
    with contextlib.suppress(ValueError):
        # Reject early when the client announces the size; multipart overhead is small.
        if int(request.headers.get("content-length", "0")) > max_bytes + 64 * 1024:
            raise _error(413, "file_too_large", max_mb=max_bytes // (1024 * 1024))

    async with request.form(max_files=1, max_fields=4) as form:
        file = form.get("file")
        if not isinstance(file, UploadFile):
            raise _error(422, "no_file")
        filename = PurePath(file.filename or "audio").name[:255]
        if not _accepted_type(filename, file.content_type or ""):
            raise _error(415, "unsupported_type")
        path, file_hash = await _save_upload(file, max_bytes)

    return await _queue_or_cached(
        session, user, response,
        source=AnalysisSource.UPLOAD, source_ref=filename,
        title=PurePath(filename).stem[:255] or None,
        file_hash=file_hash, media_path=path,
    )


@router.get("/history", response_model=AnalysisHistoryOut)
async def history(user: CurrentUser, session: Session) -> AnalysisHistoryOut:
    rows = (
        await session.scalars(
            select(Analysis)
            .where(Analysis.user_id == user.id)
            .order_by(Analysis.created_at.desc(), Analysis.id.desc())
            .limit(HISTORY_LEN)
        )
    ).all()
    return AnalysisHistoryOut(
        remaining_today=await remaining_today(session, user),
        daily_limit=get_settings().analyze_free_per_day,
        items=[AnalysisSummary.build(a) for a in rows],
    )


@router.get("/{analysis_id}", response_model=AnalysisOut)
async def get_analysis(analysis_id: int, user: CurrentUser, session: Session) -> AnalysisOut:
    row = await session.scalar(
        select(Analysis).where(Analysis.id == analysis_id, Analysis.user_id == user.id)
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "analysis not found")
    return AnalysisOut.build(row)
