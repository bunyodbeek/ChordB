#!/bin/sh
# Daily yt-dlp update inside the running worker container (YouTube changes often).
# Run by chordb-ytdlp-update.timer; output goes to the journal:
#   journalctl -u chordb-ytdlp-update
#
# The worker's venv is managed by uv and has no pip, so this is `uv pip install -U`,
# the uv equivalent of `pip install -U yt-dlp`. The worker restarts only when the
# version changed; jobs it was running are requeued on start.
#
# A rebuild (`up --build`) goes back to the version in uv.lock, so run this script
# right after every deploy too.
set -eu

cd "${CHORDB_DIR:-/opt/chordb}"
compose="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
version() {
    $compose exec -T worker python -c "import yt_dlp.version as v; print(v.__version__)"
}

before=$(version)
$compose exec -T worker uv pip install --quiet --python /opt/venv/bin/python -U \
    yt-dlp yt-dlp-ejs deno
after=$(version)

if [ "$before" != "$after" ]; then
    $compose restart worker
    echo "yt-dlp update: $before -> $after (worker restarted)"
else
    echo "yt-dlp update: $after is the latest"
fi
