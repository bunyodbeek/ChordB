from fastapi import APIRouter, FastAPI

from chordb_common.config import get_settings

from app.routes import me

settings = get_settings()
is_dev = settings.env == "dev"

app = FastAPI(
    title="ChordB API",
    docs_url="/api/docs" if is_dev else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if is_dev else None,
)

api = APIRouter(prefix="/api")
api.include_router(me.router)


@api.get("/healthz", include_in_schema=False)
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(api)
