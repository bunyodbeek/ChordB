"""Daily practice (tune → chord switch → ear test), streaks, game results, chord collection."""

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from chordb_common.models import (
    ChordCollection,
    Game,
    GameResult,
    PersonalBest,
    PracticeDay,
    PracticeStep,
    Quality,
    Streak,
    User,
    UserEventType,
)
from chordb_common.notation import Chord, format_chord
from chordb_common.practice import (
    COLLECTIBLE,
    DEFAULT_CHAIN,
    STEPS,
    StreakState,
    complete_day,
    current_streak,
    local_date,
    refill,
)

from app.deps import CurrentUser, Session
from app.premium import log_event
from app.schemas import (
    MAX_SWITCHES_PER_MIN,
    ChordModel,
    ChordSwitchDetails,
    CollectedChord,
    GameResultIn,
    GameResultOut,
    PersonalBestOut,
    StepIn,
    StreakOut,
    SummaryOut,
    TodayOut,
    UnlockIn,
)

router = APIRouter(tags=["practice"])

GAME_STEP = {Game.CHORD_SWITCH: PracticeStep.CHORD_SWITCH, Game.EAR_TEST: PracticeStep.EAR_TEST}


def _invalid(reason: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, {"code": "invalid_result", "reason": reason})


FLAT_ROOTS = {3, 8, 10}  # Eb Ab Bb: the usual guitar spelling, like the webapp


def chord_name(root: int, quality: Quality) -> str:
    return format_chord(Chord(root, quality, flat=root in FLAT_ROOTS), "letter")


def _state(row: Streak | None) -> StreakState:
    if row is None:
        return StreakState()
    return StreakState(
        current=row.current,
        best=row.best,
        last_practice_date=row.last_practice_date,
        freezes_left=row.freezes_left,
        freezes_month=row.freezes_month,
    )


def _streak_out(state: StreakState, user: User, now: datetime) -> StreakOut:
    today = local_date(now, user.timezone)
    shown = refill(state, today, user.has_premium)
    return StreakOut(
        current=current_streak(state, today, premium=user.has_premium),
        best=state.best,
        freezes_left=shown.freezes_left,
        last_practice_date=state.last_practice_date,
    )


async def _day(session: Session, user: User, now: datetime, *, lock: bool = False) -> PracticeDay | None:
    stmt = select(PracticeDay).where(
        PracticeDay.user_id == user.id, PracticeDay.date == local_date(now, user.timezone)
    )
    return await session.scalar(stmt.with_for_update() if lock else stmt)


async def _today(session: Session, user: User, now: datetime) -> TodayOut:
    day = await _day(session, user, now)
    streak = await session.get(Streak, user.id)
    done = set(day.steps_done) if day else set()
    return TodayOut(
        date=local_date(now, user.timezone),
        steps=list(STEPS),
        steps_done=[s for s in STEPS if s.value in done],
        completed=bool(day and day.completed),
        chain=[ChordModel(root=r, quality=q) for r, q in DEFAULT_CHAIN],
        streak=_streak_out(_state(streak), user, now),
    )


async def mark_step(session: Session, user: User, step: PracticeStep, now: datetime) -> None:
    """Record a done step for today; the last of the three completes the day. No commit."""
    today = local_date(now, user.timezone)
    await session.execute(
        insert(PracticeDay)
        .values(user_id=user.id, date=today)
        .on_conflict_do_nothing(constraint="uq_practice_days_user_date")
    )
    day = await _day(session, user, now, lock=True)
    assert day is not None
    await log_event(session, user, UserEventType.PRACTICE_STEP, ref=step.value)
    if step.value in day.steps_done:
        return
    day.steps_done = [s.value for s in STEPS if s.value in {*day.steps_done, step.value}]
    day.updated_at = now
    if day.completed or len(day.steps_done) < len(STEPS):
        return
    day.completed = True
    day.completed_at = now

    await session.execute(
        insert(Streak).values(user_id=user.id).on_conflict_do_nothing(index_elements=[Streak.user_id])
    )
    row = await session.get(Streak, user.id, with_for_update=True, populate_existing=True)
    assert row is not None
    s = complete_day(_state(row), today, premium=user.has_premium)
    row.current, row.best = s.current, s.best
    row.last_practice_date, row.freezes_left, row.freezes_month = (
        s.last_practice_date, s.freezes_left, s.freezes_month,
    )


@router.get("/practice/today", response_model=TodayOut)
async def today(user: CurrentUser, session: Session) -> TodayOut:
    return await _today(session, user, datetime.now(UTC))


@router.post("/practice/step", response_model=TodayOut)
async def step(body: StepIn, user: CurrentUser, session: Session) -> TodayOut:
    now = datetime.now(UTC)
    await mark_step(session, user, body.step, now)
    await session.commit()
    return await _today(session, user, now)


@router.get("/practice/summary", response_model=SummaryOut)
async def summary(user: CurrentUser, session: Session) -> SummaryOut:
    now = datetime.now(UTC)
    day = await _today(session, user, now)
    bests = (
        await session.scalars(
            select(PersonalBest)
            .where(PersonalBest.user_id == user.id)
            .order_by(PersonalBest.game, PersonalBest.chain_key)
        )
    ).all()
    return SummaryOut(
        streak=day.streak,
        today=day,
        bests=[PersonalBestOut(game=b.game, chain_key=b.chain_key, value=b.value) for b in bests],
        collection=await _collection(session, user),
        collectible=[ChordModel(root=r, quality=q) for r, q in COLLECTIBLE],
    )


def _validate(body: GameResultIn) -> tuple[str, dict]:
    """The personal-best key and the normalised details, or 422 for impossible results."""
    if body.game == Game.EAR_TEST:
        # The server checks the ear test itself: /api/ear/runs.
        raise _invalid("ear test results come from /api/ear/runs")
    try:
        d = ChordSwitchDetails.model_validate(body.details)
    except ValidationError as e:
        raise _invalid(e.errors(include_url=False)[0]["msg"]) from None
    if body.score != d.switches:
        raise _invalid("score must equal switches")
    if d.switches > MAX_SWITCHES_PER_MIN * d.duration_sec / 60:
        raise _invalid("too many switches for the time")
    if d.chains > d.switches // len(d.chain) + 1:
        raise _invalid("more chains than switches allow")
    key = "-".join(chord_name(c.root, c.quality) for c in d.chain)
    return key, d.model_dump(mode="json")


async def record_game(
    session: Session, user: User, game: Game, score: int, key: str, details: dict, now: datetime
) -> tuple[GameResult, int, bool]:
    """Save a finished game, raise the personal best, mark the day's step. No commit.

    Returns the result row, the best after it and whether it is a new best.
    """
    result = GameResult(user_id=user.id, game=game, score=score, details=details)
    session.add(result)
    before = await session.scalar(
        select(PersonalBest.value).where(
            PersonalBest.user_id == user.id, PersonalBest.game == game, PersonalBest.chain_key == key
        )
    )
    stmt = insert(PersonalBest).values(user_id=user.id, game=game, chain_key=key, value=score)
    best = await session.scalar(
        stmt.on_conflict_do_update(
            index_elements=[PersonalBest.user_id, PersonalBest.game, PersonalBest.chain_key],
            set_={"value": func.greatest(PersonalBest.value, stmt.excluded.value), "updated_at": now},
        ).returning(PersonalBest.value)
    )
    await log_event(session, user, UserEventType.GAME_FINISH, ref=game.value)
    await mark_step(session, user, GAME_STEP[game], now)
    return result, best or score, before is None or score > before


@router.post("/games/result", response_model=GameResultOut, status_code=status.HTTP_201_CREATED)
async def game_result(body: GameResultIn, user: CurrentUser, session: Session) -> GameResultOut:
    key, details = _validate(body)
    now = datetime.now(UTC)
    result, best, new_best = await record_game(session, user, body.game, body.score, key, details, now)
    await session.commit()
    await session.refresh(result)
    return GameResultOut(
        id=result.id,
        game=body.game,
        score=body.score,
        best=best,
        new_best=new_best,
        today=await _today(session, user, now),
    )


async def _collection(session: Session, user: User) -> list[CollectedChord]:
    rows = (
        await session.scalars(
            select(ChordCollection)
            .where(ChordCollection.user_id == user.id)
            .order_by(ChordCollection.unlocked_at, ChordCollection.id)
        )
    ).all()
    return [
        CollectedChord(root=r.root, quality=r.quality, mode=r.mode, unlocked_at=r.unlocked_at)
        for r in rows
    ]


@router.post("/collection/unlock", response_model=list[CollectedChord])
async def unlock(body: UnlockIn, user: CurrentUser, session: Session) -> list[CollectedChord]:
    """Add a chord to the collection; unlocking one already there changes nothing."""
    inserted = await session.scalar(
        insert(ChordCollection)
        .values(user_id=user.id, root=body.root, quality=body.quality, mode=body.mode)
        .on_conflict_do_nothing(constraint="uq_chord_collection_chord")
        .returning(ChordCollection.id)
    )
    if inserted is not None:
        await log_event(session, user, UserEventType.CHORD_UNLOCK, ref=chord_name(body.root, body.quality))
    await session.commit()
    return await _collection(session, user)
