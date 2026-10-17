from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Response, status

from app.deps import CurrentUser, Session
from app.schemas import EventIn, MeOut, SettingsPatch

router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=MeOut)
async def get_me(user: CurrentUser) -> MeOut:
    return MeOut.from_user(user)


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
        case "write_access_requested":
            user.write_access_requested_at = user.write_access_requested_at or now
        case "write_access_granted":
            user.write_access_requested_at = user.write_access_requested_at or now
            user.allows_write_to_pm = True
    session.add(user)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
