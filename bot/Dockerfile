# Build context is the repo root: docker build -f bot/Dockerfile .
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
COPY bot/pyproject.toml bot/
RUN mkdir -p common/chordb_common backend/app bot/chordb_bot \
 && uv sync --frozen --no-dev --no-install-workspace --package chordb-bot

COPY common common
COPY bot bot
RUN uv sync --frozen --no-dev --package chordb-bot

ENV PATH="/opt/venv/bin:$PATH"
WORKDIR /src/bot
CMD ["python", "-m", "chordb_bot.main"]
