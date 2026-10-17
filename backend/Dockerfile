# Build context is the repo root: docker build -f backend/Dockerfile .
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv
RUN pip install --no-cache-dir uv==0.11.32

WORKDIR /src
# Workspace manifests first for layer caching.
COPY pyproject.toml uv.lock ./
COPY common/pyproject.toml common/
COPY backend/pyproject.toml backend/
RUN mkdir -p common/chordb_common backend/app \
 && uv sync --frozen --no-dev --no-install-workspace --package chordb-backend

COPY common common
COPY backend backend
RUN uv sync --frozen --no-dev --package chordb-backend

ENV PATH="/opt/venv/bin:$PATH" HOST=0.0.0.0 PORT=8001
WORKDIR /src/backend
EXPOSE 8001
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host $HOST --port $PORT --proxy-headers --forwarded-allow-ips=127.0.0.1"]
