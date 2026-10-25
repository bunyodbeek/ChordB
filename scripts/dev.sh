#!/usr/bin/env bash
# Starts everything needed to use the Mini App inside Telegram: the local Postgres
# container and the migrations, then the API, the chord-detection worker, the webapp dev
# server, an HTTPS tunnel and the bot. The tunnel URL goes into .env as WEBAPP_URL and
# onto the bot's menu button, so the bot always opens the app that is running.
# Ctrl+C stops everything it started.
#
# Usage (from anywhere):
#   scripts/dev.sh [--no-bot] [--no-api] [--no-web] [--no-worker] [--no-tunnel] [--keep-db]
#
# TUNNEL in .env picks the tunnel: cloudflared (default) or ngrok. A reserved ngrok domain
# is used when NGROK_DOMAIN is set; otherwise the tunnel gets a new random URL on every
# start, which has to be pasted into @BotFather again.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API_PORT=8001
WEB_PORT=5173
NGROK_API=127.0.0.1:4040
LOG_DIR="$ROOT/logs"

no_bot= no_api= no_web= no_worker= no_tunnel= keep_db=
for arg in "$@"; do
  case "$arg" in
    --no-bot)    no_bot=1 ;;
    --no-api)    no_api=1 ;;
    --no-web)    no_web=1 ;;
    --no-worker) no_worker=1 ;;
    --no-tunnel) no_tunnel=1 ;;  # browser testing only: Telegram cannot reach the app
    --keep-db)   keep_db=1 ;;    # leave the Postgres container running on exit
    -h|--help)   sed -n '2,/^[^#]/p' "${BASH_SOURCE[0]}" | sed '$d; s/^# \?//'; exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

bold=$'\033[1m'; green=$'\033[32m'; yellow=$'\033[33m'; red=$'\033[31m'; off=$'\033[0m'
say()  { printf '%s\n' "${bold}$*${off}"; }
ok()   { printf '%s\n' "${green}$*${off}"; }
warn() { printf '%s\n' "${yellow}$*${off}"; }
die()  { printf '%s\n' "${red}$*${off}" >&2; exit 1; }

# One value out of .env, without sourcing it (values may contain spaces or #).
env_value() {
  [ -f "$ROOT/.env" ] || return 0
  sed -n "s/^$1=//p" "$ROOT/.env" | tail -1 | sed 's/^"//; s/"$//'
}

# --- stop: kill the children, then the tunnel and the container -------------------
PIDS=()

# Children first: uvicorn --reload, npm -> vite and the worker's analysis processes are
# all grandchildren of the pid we started, and would survive killing only the parent.
kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child" "$2"; done
  kill "-$2" "$pid" 2>/dev/null
}

cleanup() {
  trap - INT TERM EXIT
  echo
  say 'Stopping...'
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill_tree "$pid" TERM; done
  for _ in $(seq 1 20); do
    still=
    for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && still=1; done
    [ -z "$still" ] && break
    sleep 0.25
  done
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill_tree "$pid" KILL; done
  if [ -z "$keep_db" ]; then
    docker compose --profile local stop postgres >/dev/null 2>&1 && ok 'Postgres: stopped' \
      || warn 'Postgres: could not stop the container'
  else
    ok 'Postgres: left running (--keep-db)'
  fi
  ok 'All stopped.'
}
trap cleanup INT TERM EXIT

# Runs a service in its own process group, logging to logs/<name>.log and to this
# terminal with a prefix.
start_service() {
  local name="$1" dir="$2"; shift 2
  local log="$LOG_DIR/$name.log"
  : > "$log"
  ( cd "$dir" && exec "$@" >"$log" 2>&1 ) &
  PIDS+=("$!")
  ( tail -n +1 -f "$log" 2>/dev/null | sed -u "s/^/[$name] /" ) &
  PIDS+=("$!")
}

mkdir -p "$LOG_DIR"

# --- checks -----------------------------------------------------------------------
command -v docker >/dev/null || die 'docker not found'
command -v uv     >/dev/null || die 'uv not found'
[ -f "$ROOT/.env" ] || die '.env not found: cp .env.example .env and fill in BOT_TOKEN'

BOT_TOKEN="$(env_value BOT_TOKEN)"
NGROK_DOMAIN="$(env_value NGROK_DOMAIN)"
TUNNEL="$(env_value TUNNEL)"
have_token=1
case "$BOT_TOKEN" in ''|*replace-me*) have_token= ;; esac

# --- Postgres ---------------------------------------------------------------------
say 'Postgres: starting the local container...'
docker compose --profile local up -d postgres >/dev/null 2>&1 || die 'Could not start the Postgres container'
for _ in $(seq 1 60); do
  [ "$(docker compose ps postgres --format '{{.Health}}' 2>/dev/null)" = healthy ] && break
  sleep 1
done
[ "$(docker compose ps postgres --format '{{.Health}}' 2>/dev/null)" = healthy ] \
  || die 'Postgres did not become healthy: docker compose logs postgres'
ok "Postgres: ready on 127.0.0.1:$(env_value POSTGRES_PORT || echo 5432)"

# The test database is separate and only used by pytest; create it once, quietly.
docker compose exec -T postgres psql -U chordb -d chordb -tAc \
  "select 1 from pg_database where datname='chordb_test'" 2>/dev/null | grep -q 1 \
  || docker compose exec -T postgres createdb -U chordb chordb_test >/dev/null 2>&1

# --- migrations -------------------------------------------------------------------
say 'Migrations: alembic upgrade head'
( cd backend && uv run alembic upgrade head ) || die 'Migrations failed'

# --- webapp deps and a fresh dev login --------------------------------------------
if [ -z "$no_web" ]; then
  if [ ! -d webapp/node_modules ]; then
    # npm ci, not install: install rewrites package-lock.json whenever the local npm is
    # older than the one that wrote it, which is churn nobody asked for.
    say 'Webapp: npm ci'
    ( cd webapp && npm ci --no-fund --no-audit ) || die 'npm ci failed'
  fi
  # Signed initData lets the webapp call the API from a plain browser. It expires after
  # 24h, so make a new one on every start. Inside Telegram it is ignored.
  if init_data="$(cd backend && uv run python -m app.dev_init_data --id 1001 --first-name Dev 2>/dev/null)" \
     && [ -n "$init_data" ]; then
    printf 'VITE_DEV_INIT_DATA="%s"\n' "$init_data" > webapp/.env.local
    ok 'Webapp: dev login written to webapp/.env.local'
  else
    warn 'Webapp: could not make a dev login (ENV=prod?), the browser will say "open in Telegram"'
  fi
fi

# --- HTTPS tunnel -----------------------------------------------------------------
# Telegram opens Mini Apps only over HTTPS, so the tunnel has to come up before the API
# and the bot start: both read WEBAPP_URL.
#
# TUNNEL in .env picks the tool. cloudflared is the default because ngrok's free domains
# answer every request with a "You are about to visit ..." interstitial (ERR_NGROK_6024),
# which is what Telegram's webview would show instead of the Mini App. ngrok is fine on a
# paid plan, where that page is gone.
tunnel_url=

# The public URL out of the local ngrok agent's API.
ngrok_url() {
  curl -s --max-time 2 "http://$NGROK_API/api/tunnels" 2>/dev/null | python3 -c '
import json, sys
try:
    tunnels = json.load(sys.stdin)["tunnels"]
except Exception:
    raise SystemExit
print(next((t["public_url"] for t in tunnels if t["public_url"].startswith("https")), ""))
' 2>/dev/null
}

start_ngrok() {
  if curl -s --max-time 2 "http://$NGROK_API/api/tunnels" >/dev/null 2>&1; then
    warn "Tunnel: an ngrok agent is already running on $NGROK_API, reusing it"
    tunnel_url="$(ngrok_url)"
    return
  fi
  say 'Tunnel: starting ngrok...'
  if [ -n "$NGROK_DOMAIN" ]; then
    start_service ngrok "$ROOT" ngrok http "$WEB_PORT" --url "$NGROK_DOMAIN" --log=stdout
  else
    start_service ngrok "$ROOT" ngrok http "$WEB_PORT" --log=stdout
  fi
  for _ in $(seq 1 40); do
    tunnel_url="$(ngrok_url)"
    [ -n "$tunnel_url" ] && break
    sleep 0.5
  done
  case "$tunnel_url" in
    *ngrok-free*)
      warn 'Tunnel: a free ngrok domain answers every request with the ngrok interstitial,'
      warn '        so Telegram will not open the app. Use TUNNEL=cloudflared, or a paid plan.' ;;
  esac
}

start_cloudflared() {
  say 'Tunnel: starting cloudflared...'
  start_service tunnel "$ROOT" cloudflared tunnel --no-autoupdate --url "http://localhost:$WEB_PORT"
  for _ in $(seq 1 60); do
    tunnel_url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/tunnel.log" 2>/dev/null | head -1)"
    [ -n "$tunnel_url" ] && break
    sleep 0.5
  done
}

if [ -z "$no_tunnel" ] && [ -z "$no_web" ]; then
  case "${TUNNEL:-}" in
    none) ok 'Tunnel: skipped (TUNNEL=none)' ;;
    ngrok)
      if command -v ngrok >/dev/null; then
        start_ngrok
      else
        warn 'Tunnel: ngrok not found (snap install ngrok), Telegram will not be able to open the app'
      fi ;;
    *)
      if command -v cloudflared >/dev/null; then
        start_cloudflared
      elif command -v ngrok >/dev/null; then
        warn 'Tunnel: cloudflared not found, falling back to ngrok'
        start_ngrok
      else
        warn 'Tunnel: no cloudflared and no ngrok, Telegram will not be able to open the app'
      fi ;;
  esac

  if [ -n "$tunnel_url" ]; then
    # The API and the bot read WEBAPP_URL from .env, so put it there before they start.
    if grep -q '^WEBAPP_URL=' .env; then
      python3 - "$tunnel_url" <<'PY'
import pathlib, re, sys
p = pathlib.Path(".env")
p.write_text(re.sub(r"(?m)^WEBAPP_URL=.*$", "WEBAPP_URL=" + sys.argv[1], p.read_text()))
PY
    else
      printf 'WEBAPP_URL=%s\n' "$tunnel_url" >> .env
    fi
    ok "Tunnel: $tunnel_url (written to .env as WEBAPP_URL)"
    [ -n "$NGROK_DOMAIN" ] || warn 'Tunnel: this URL is new on every start, so @BotFather needs it again. A reserved ngrok domain in NGROK_DOMAIN, or a named Cloudflare tunnel, keeps it stable.'
  elif [ "${TUNNEL:-}" != none ]; then
    warn 'Tunnel: no URL, see logs/'
  fi
fi

# --- API, worker, webapp, bot -----------------------------------------------------
if [ -z "$no_api" ]; then
  start_service api "$ROOT/backend" uv run uvicorn app.main:app --reload --port "$API_PORT"
  for _ in $(seq 1 60); do
    curl -sf "http://127.0.0.1:$API_PORT/api/healthz" >/dev/null 2>&1 && break
    sleep 0.5
  done
  if curl -sf "http://127.0.0.1:$API_PORT/api/healthz" >/dev/null 2>&1; then
    ok "API: http://127.0.0.1:$API_PORT  (docs: /api/docs)"
  else
    warn 'API: not answering /api/healthz yet, see logs/api.log'
  fi
fi

if [ -z "$no_worker" ]; then
  command -v ffmpeg >/dev/null || warn 'Worker: ffmpeg not found, analyses will fail (sudo apt install ffmpeg)'
  start_service worker "$ROOT/backend" uv run python -m app.worker
  ok 'Worker: chord detection (ready after ~10 s)'
fi

if [ -z "$no_web" ]; then
  if [ -z "$no_tunnel" ]; then
    # Telegram testing: no HMR, so a dropped tunnel socket can't reload the page mid-game.
    # Edits show after reopening the app (or a manual reload).
    start_service web "$ROOT/webapp" env VITE_HMR=off npm run dev
    ok "Webapp: http://localhost:$WEB_PORT  (HMR off: reopen the app to see edits)"
  else
    start_service web "$ROOT/webapp" npm run dev
    ok "Webapp: http://localhost:$WEB_PORT"
  fi
fi

if [ -z "$no_bot" ]; then
  if [ -z "$have_token" ]; then
    warn 'Bot: skipped, set a real BOT_TOKEN in .env first'
  else
    start_service bot "$ROOT" uv run python -m chordb_bot.main
    ok 'Bot: started (long polling)'
  fi
fi

# --- bot menu button -> the tunnel ------------------------------------------------
# The bot sets this on start too; doing it here as well means it is right the moment
# this script finishes, and the check below shows what Telegram now has.
if [ -n "$tunnel_url" ] && [ -z "$no_bot" ] && [ -n "$have_token" ]; then
  api="https://api.telegram.org/bot$BOT_TOKEN"
  # Never print curl's errors here: their text contains the URL, i.e. the bot token.
  if curl -s -o /dev/null --max-time 10 -X POST "$api/setChatMenuButton" \
       -H 'content-type: application/json' \
       -d "$(printf '{"menu_button":{"type":"web_app","text":"Sozlash","web_app":{"url":"%s/"}}}' "$tunnel_url")" 2>/dev/null
  then
    username="$(curl -s --max-time 10 "$api/getMe" 2>/dev/null \
      | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["username"])' 2>/dev/null)"
    [ -n "$username" ] && ok "Telegram: open @$username and tap the menu button" \
      || warn 'Telegram: menu button set, but getMe failed (network?)'
  else
    warn 'Telegram: could not set the menu button (network?)'
  fi
fi

echo
say 'Running. Ctrl+C stops everything. Logs are in logs/.'
echo
# Wait for the children; the trap does the stopping.
wait
