import logging

from fastapi import APIRouter, FastAPI

from chordb_common.config import get_settings

from app.routes import admin, admin_stats, admin_users, analyze, ear, me, payments, practice, songs

settings = get_settings()
is_dev = settings.env == "dev"

# uvicorn configures only its own loggers; give ours (event lines) a handler too.
_chordb_log = logging.getLogger("chordb")
if not _chordb_log.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    _chordb_log.addHandler(_handler)
    _chordb_log.setLevel(logging.INFO)

app = FastAPI(
    title="ChordB API",
    docs_url="/api/docs" if is_dev else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if is_dev else None,
)

api = APIRouter(prefix="/api")
api.include_router(me.router)
api.include_router(songs.router)
api.include_router(admin.router)
api.include_router(admin_users.router)
api.include_router(admin_stats.router)
api.include_router(payments.router)
api.include_router(practice.router)
api.include_router(ear.router)
api.include_router(analyze.router)


@api.get("/healthz", include_in_schema=False)
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(api)
