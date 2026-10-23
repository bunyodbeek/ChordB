"""Ear test: eight levels, ten questions a run, the next level only after 10/10.

The server decides everything: it makes the questions, keeps the answers, checks each
choice and opens levels. The webapp gets the options and the voicing to play.
"""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert

from chordb_common import ear
from chordb_common.models import (
    EarProgress,
    EarRun,
    EarRunStatus,
    Game,
    Quality,
    User,
    UserEventType,
)

from app.deps import CurrentUser, Session
from app.premium import log_event
from app.routes.practice import record_game
from app.schemas import (
    ChordModel,
    EarActiveRun,
    EarAnsweredOut,
    EarAnswerIn,
    EarAnswerOut,
    EarFinishOut,
    EarLevelOut,
    EarMistake,
    EarOption,
    EarProgressOut,
    EarQuestionOut,
    EarRunIn,
    EarRunOut,
    EarSide,
)

router = APIRouter(prefix="/ear", tags=["ear"])

RUN_TTL = timedelta(minutes=ear.RUN_MINUTES)


def _error(code: int, name: str, **extra) -> HTTPException:
    return HTTPException(code, {"code": name, **extra})


def _chords(item: ear.Item) -> list[ChordModel]:
    return [ChordModel(root=r, quality=q) for r, q in item]


def _played(question: dict) -> ear.Item:
    return tuple((r, Quality(q)) for r, q in question["chords"])


def _expires(run: EarRun) -> datetime:
    return run.created_at + RUN_TTL


async def _progress(session: Session, user: User, *, lock: bool = False) -> EarProgress:
    await session.execute(
        insert(EarProgress).values(user_id=user.id).on_conflict_do_nothing(index_elements=[EarProgress.user_id])
    )
    row = await session.get(EarProgress, user.id, with_for_update=lock, populate_existing=True)
    assert row is not None
    return row


async def _run(session: Session, user: User, run_id: uuid.UUID) -> EarRun:
    """The user's run, locked; 404 if it isn't theirs, 410 once expired."""
    run = await session.get(EarRun, run_id, with_for_update=True, populate_existing=True)
    if run is None or run.user_id != user.id:
        raise _error(status.HTTP_404_NOT_FOUND, "run_not_found")
    if run.status == EarRunStatus.ACTIVE and _expires(run) <= datetime.now(UTC):
        run.status = EarRunStatus.EXPIRED
        await session.commit()
    if run.status == EarRunStatus.EXPIRED:
        raise _error(status.HTTP_410_GONE, "run_expired")
    return run


def _answer_out(run: EarRun, a: dict) -> EarAnsweredOut:
    q = run.questions[a["question_id"]]
    return EarAnsweredOut(
        question_id=a["question_id"],
        choice=a["choice"],
        correct=a["correct"],
        correct_answer=q["answer"],
        played=_chords(_played(q)),
    )


def _run_out(run: EarRun) -> EarRunOut:
    lv = ear.level(run.level)
    return EarRunOut(
        run_id=run.id,
        level=run.level,
        kind=lv.kind,
        title=lv.title,
        expires_at=_expires(run),
        questions=[
            EarQuestionOut(
                question_id=i,
                options=[EarOption(id=o, chords=_chords(ear.parse_id(o))) for o in q["options"]],
                voicing=[ear.voicing(c) for c in _played(q)],
            )
            for i, q in enumerate(run.questions)
        ],
        answered=[_answer_out(run, a) for a in run.answers],
    )


@router.get("/progress", response_model=EarProgressOut)
async def progress(user: CurrentUser, session: Session) -> EarProgressOut:
    p = await _progress(session, user)
    await session.commit()
    now = datetime.now(UTC)
    perfect_runs = await session.scalar(
        select(func.count()).select_from(EarRun).where(
            EarRun.user_id == user.id,
            EarRun.status == EarRunStatus.FINISHED,
            EarRun.score == ear.QUESTIONS,
        )
    )
    active = await session.scalar(
        select(EarRun)
        .where(
            EarRun.user_id == user.id,
            EarRun.status == EarRunStatus.ACTIVE,
            EarRun.created_at > now - RUN_TTL,
        )
        .order_by(EarRun.created_at.desc())
        .limit(1)
    )
    return EarProgressOut(
        max_unlocked_level=p.max_unlocked_level,
        level_count=ear.LEVEL_COUNT,
        perfect_streak=p.perfect_streak,
        perfect_runs=perfect_runs or 0,
        levels=[
            EarLevelOut(
                level=lv.number,
                title=lv.title,
                kind=lv.kind,
                premium=lv.premium,
                shown=[_chords(g) for g in lv.shown],
                note=lv.note,
                unlocked=lv.number <= p.max_unlocked_level,
                best=p.best_score_per_level.get(str(lv.number)),
            )
            for lv in ear.LEVELS
        ],
        active_run=(
            EarActiveRun(run_id=active.id, level=active.level, answered=len(active.answers),
                         expires_at=_expires(active))
            if active
            else None
        ),
    )


@router.post(
    "/runs",
    response_model=EarRunOut,
    status_code=status.HTTP_201_CREATED,
    responses={402: {"description": "Premium level"}, 403: {"description": "Level not unlocked yet"}},
)
async def start_run(body: EarRunIn, user: CurrentUser, session: Session) -> EarRunOut:
    lv = ear.level(body.level)
    p = await _progress(session, user)
    if lv.number > p.max_unlocked_level:
        raise _error(status.HTTP_403_FORBIDDEN, "level_locked")
    if lv.premium and not user.has_premium:
        raise _error(status.HTTP_402_PAYMENT_REQUIRED, "premium_required", paywall=True)
    # One run at a time: a new one replaces any unfinished one.
    await session.execute(
        update(EarRun)
        .where(EarRun.user_id == user.id, EarRun.status == EarRunStatus.ACTIVE)
        .values(status=EarRunStatus.EXPIRED)
    )
    run = EarRun(user_id=user.id, level=lv.number, questions=ear.make_questions(lv.number), answers=[])
    session.add(run)
    await log_event(session, user, UserEventType.GAME_START, ref=Game.EAR_TEST.value)
    await session.commit()
    await session.refresh(run)
    return _run_out(run)


@router.get("/runs/{run_id}", response_model=EarRunOut)
async def get_run(run_id: uuid.UUID, user: CurrentUser, session: Session) -> EarRunOut:
    run = await _run(session, user, run_id)
    if run.status != EarRunStatus.ACTIVE:
        raise _error(status.HTTP_409_CONFLICT, "run_finished")
    out = _run_out(run)
    await session.commit()  # release the lock
    return out


@router.post("/runs/{run_id}/answer", response_model=EarAnswerOut)
async def answer(run_id: uuid.UUID, body: EarAnswerIn, user: CurrentUser, session: Session) -> EarAnswerOut:
    run = await _run(session, user, run_id)
    if run.status != EarRunStatus.ACTIVE:
        raise _error(status.HTTP_409_CONFLICT, "run_finished")
    if body.question_id >= len(run.questions):
        raise _error(status.HTTP_404_NOT_FOUND, "question_not_found")
    if body.question_id < len(run.answers):
        raise _error(status.HTTP_409_CONFLICT, "already_answered")
    if body.question_id > len(run.answers):
        raise _error(status.HTTP_409_CONFLICT, "out_of_order")
    q = run.questions[body.question_id]
    if body.choice not in q["options"]:
        raise _error(status.HTTP_422_UNPROCESSABLE_CONTENT, "unknown_choice")
    correct = body.choice == q["answer"]
    run.answers = [*run.answers, {"question_id": body.question_id, "choice": body.choice, "correct": correct}]
    await session.commit()
    return EarAnswerOut(correct=correct, correct_answer=q["answer"], played=_chords(_played(q)))


def _side(option: str, played: ear.Item) -> EarSide:
    chords = ear.parse_id(option) or ear.contrast(option, played)
    return EarSide(id=option, chords=_chords(chords), voicing=[ear.voicing(c) for c in chords])


def _mistakes(run: EarRun) -> list[EarMistake]:
    out = []
    for a in run.answers:
        if a["correct"]:
            continue
        q = run.questions[a["question_id"]]
        played = _played(q)
        out.append(EarMistake(
            question_id=a["question_id"],
            asked=EarSide(id=q["answer"], chords=_chords(played), voicing=[ear.voicing(c) for c in played]),
            answered=_side(a["choice"], played),
        ))
    return out


@router.post("/runs/{run_id}/finish", response_model=EarFinishOut)
async def finish(run_id: uuid.UUID, user: CurrentUser, session: Session) -> EarFinishOut:
    """Score the run and open the next level on 10/10. Finishing again repeats the result."""
    run = await _run(session, user, run_id)
    if len(run.answers) < len(run.questions):
        raise _error(status.HTTP_409_CONFLICT, "unanswered", answered=len(run.answers))
    score = sum(a["correct"] for a in run.answers)
    perfect = score == ear.QUESTIONS
    p = await _progress(session, user, lock=True)

    if run.status == EarRunStatus.ACTIVE:
        now = datetime.now(UTC)
        run.score, run.status, run.finished_at = score, EarRunStatus.FINISHED, now
        key = str(run.level)
        p.best_score_per_level = {**p.best_score_per_level, key: max(score, p.best_score_per_level.get(key, 0))}
        p.perfect_streak = p.perfect_streak + 1 if perfect else 0
        if perfect and run.level == p.max_unlocked_level and run.level < ear.LEVEL_COUNT:
            p.max_unlocked_level = run.level + 1
        p.updated_at = now
        await record_game(
            session, user, Game.EAR_TEST, score, f"level{run.level}",
            {"level": run.level, "run_id": str(run.id)}, now,
        )

    out = EarFinishOut(
        score=score,
        perfect=perfect,
        level=run.level,
        unlocked_level=run.level + 1 if perfect and run.level < ear.LEVEL_COUNT else None,
        max_unlocked_level=p.max_unlocked_level,
        best=p.best_score_per_level.get(str(run.level), score),
        mistakes=_mistakes(run),
    )
    await session.commit()
    return out
