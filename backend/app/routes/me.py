from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request, Response, status

from chordb_common.models import Game, UserEventType

from app.deps import CurrentUser, Session
from app.premium import log_event, parse_song_param
from app.schemas import EventIn, MeOut, SettingsPatch

router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=MeOut)
async def get_me(request: Request, user: CurrentUser, session: Session) -> MeOut:
    # The webapp calls this once per launch: that is the "opened the app" signal.
    await log_event(session, user, UserEventType.APP_OPENED)
    start_param = getattr(request.state, "start_param", None)
    song_id = parse_song_param(start_param)
    if song_id is not None:
        await log_event(session, user, UserEventType.DEEP_LINK, ref=str(song_id))
    await session.commit()
    return MeOut.from_user(user).model_copy(
        update={
            "start_song_id": song_id,
            "start_tab": "practice" if start_param == "practice" else None,
        }
    )


@router.patch("/settings", response_model=MeOut)
async def patch_settings(body: SettingsPatch, user: CurrentUser, session: Session) -> MeOut:
    changes = body.model_dump(exclude_unset=True)
    if any(v is None for v in changes.values()):
        raise HTTPException(422, "settings cannot be null")
    for key, value in changes.items():
        setattr(user, key, value)
    session.add(user)
    await session.commit()
    return MeOut.from_user(user)


@router.post("/events", status_code=status.HTTP_204_NO_CONTENT)
async def post_event(body: EventIn, user: CurrentUser, session: Session) -> Response:
    now = datetime.now(UTC)
    match body.type:
        case "tuner_opened":
            if user.tuner_opened_at is None:
                user.tuner_opened_at = now
            await log_event(session, user, UserEventType.TUNER_OPENED)
        case "write_access_requested":
            user.write_access_requested_at = user.write_access_requested_at or now
        case "write_access_granted":
            user.write_access_requested_at = user.write_access_requested_at or now
            user.allows_write_to_pm = True
        case "premium_viewed":
            await log_event(session, user, UserEventType.PREMIUM_VIEWED)
        case "game_start":
            if body.ref not in set(Game):
                raise HTTPException(422, "ref must be a game")
            await log_event(session, user, UserEventType.GAME_START, ref=body.ref)
    session.add(user)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
