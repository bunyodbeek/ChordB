# ChordB

ChordB is a guitar tuner that runs as a Telegram Mini App.

| Path | What |
|---|---|
| `common/` | Shared Python package `chordb_common`: settings, SQLAlchemy models, DB session, notation formatter |
| `backend/` | FastAPI API (`/api/*`) and Alembic migrations |
| `bot/` | aiogram 3 bot (long polling) and scheduled notifications (APScheduler) |
| `webapp/` | React, Vite and TypeScript Mini App: the guitar tuner |
| `deploy/` | Nginx config for the VPS |

The Python packages form a [uv](https://docs.astral.sh/uv/) workspace with a single `uv.lock`.

## API

Every request must include the Telegram initData:

```
Authorization: tma <window.Telegram.WebApp.initData>
```

The backend checks the HMAC-SHA256 signature using `BOT_TOKEN` and rejects initData whose `auth_date` is more than 24h old. It also upserts the user on every request.

| Method | Path | |
|---|---|---|
| GET | `/api/me` | Profile, `settings` and `needs_write_access` |
| PATCH | `/api/me/settings` | `{"notation": "letter" \| "solfege", "notifications_enabled": bool}`. Either field can be omitted. |
| POST | `/api/me/events` | `{"type": "tuner_opened" \| "write_access_requested" \| "write_access_granted"}` |
| GET | `/api/songs` | `?q=&easy=&uzbek=&no_capo=`. Returns `{continue_playing, songs[]}`, published songs only. Each song has `locked` and `chords_preview` (its first 4 distinct chords). |
| GET | `/api/songs/{id}` | Song with `youtube_id`, `sections`, `events`, `position_sec`. A locked premium song gets **403** with `detail = {code: "premium_required", paywall: true, song}`. |
| PUT | `/api/songs/{id}/progress` | `{"position_sec": 61.5}`. Feeds `continue_playing`. |
| GET | `/api/healthz` | Liveness |

Chords are always canonical: `{"root": 0..11, "quality": "maj"|"min"|"7"|"maj7"|"m7"|"dim"|"aug"|"sus2"|"sus4"}`. The webapp renders them in the user's notation.

Admin endpoints accept only the Telegram ids in `ADMIN_IDS`. `/api/me` reports `is_admin` and `is_premium`. Premium here is ChordB's own `users.is_premium`, not Telegram Premium.

| Method | Path | |
|---|---|---|
| GET | `/api/admin/songs` | All songs, drafts included |
| POST | `/api/admin/songs` | Create a draft: `title, artist, youtube_id, key, capo, difficulty, language, is_premium, duration_sec` |
| PATCH | `/api/admin/songs/{id}` | Update any of those fields |
| PUT | `/api/admin/songs/{id}/events` | `{sections: [{title, start_sec}], events: [{time_sec, root, quality}]}`. Replaces the whole timeline. Each event belongs to the last section that starts at or before it. |
| PATCH | `/api/admin/songs/{id}/publish` | `{"is_published": true}`. Requires at least one chord event. |

In `ENV=dev`, interactive docs are at `/api/docs`.

## Local development

You need Python 3.12 or newer, [uv](https://docs.astral.sh/uv/getting-started/installation/), Docker, and Node 20 or newer (Node is only needed for the webapp).

```bash
cp .env.example .env          # put your BOT_TOKEN in
uv sync --all-packages        # creates .venv with all workspace packages

# Postgres (or point DATABASE_URL at your own)
docker compose --profile local up -d postgres

# Migrate and run the API with auto-reload
cd backend
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8001
```

### Running the webapp

```bash
cd webapp
npm install
npm run dev               # http://localhost:5173, proxies /api to localhost:8001
```

Outside Telegram the app needs a signed initData to log in. Put one in `webapp/.env.local` (it expires after 24h):

```bash
cd backend
echo "VITE_DEV_INIT_DATA=\"$(uv run python -m app.dev_init_data --id 1001 --first-name Bunyod)\"" > ../webapp/.env.local
```

The browser allows the microphone on `localhost`, so the tuner works there too.

The app:

- On first open, asks for letter (E A D) or solfège (Mi Lya Re) note names and saves the choice to `settings.notation`.
- Tunes in standard tuning (E2 A2 D3 G3 B3 E4). It picks the nearest string automatically, or you can lock one string. A string counts as tuned once it stays within ±5 cents for 0.6 s.
- Reports `tuner_opened` when the microphone starts. After the first string is tuned it asks for write access, once (`needs_write_access`), and reports `write_access_requested` / `write_access_granted`.
- Follows Telegram's light or dark theme.

It has four tabs:

| Tab | What |
|---|---|
| Sozlash | The tuner: big note, cents meter, headstock with the six strings |
| Akkordlar | 12 roots × 9 qualities (maj, m, 7, m7, maj7, sus2, sus4, dim, aug) as chord diagrams. Tap one to hear it strummed. |
| Qoʻshiqlar | Songs from the API: search, filters, "Davom ettirish", and a player with the YouTube video and its chords (see below) |
| Profil | Name, notation and weekly reminders |

Note and chord names everywhere follow the ABC / Do Re Mi setting.

The design specs for the songs screens are `webapp/*.reference.html`.

**Player.** The video plays through the official YouTube IFrame API, embedded, never downloaded. The player:

- reads the playback position every 100 ms and finds the current chord by binary search (`timeline.ts`);
- shows "Hozir" / "Keyingi" diagrams, a 4-beat bar (each chord event counts as one bar), and the sections grid, where tapping a bar seeks the video there;
- has Ton ±6 (changes the displayed chords only), Kapo (shapes shown relative to the capo), Tezlik 1/0.75/0.5× and loop of the current section;
- saves the position every 10 s and on pause or leave.

Videos whose owner disabled embedding (YouTube errors 101/150/153) show a message and a link to YouTube.

**Admin** (`me.is_admin`). An "Admin" button above the song list leads to the admin screens:

- **Song list:** every song, drafts included.
- **Song form:** a YouTube link or id, key, capo, difficulty, language, premium, duration and published.
- **Chord editor** (also reachable from the player's "Tahrirlash"):
  - Play the video, slowed down if you like, and tap a palette chord when the chord changes. The palette holds the song's chords plus the key's common ones; "+" adds others.
  - Each tap records `currentTime + offset`. The offset defaults to −0.15 s, compensates for tap delay, and is remembered on the device.
  - "+ Boʻlim" adds section markers. Undo, × on a row, and tapping a row (seeks the video there) all work.
  - "Saqlash va nashr qilish" replaces the whole timeline and publishes the song.
  - The editor also syncs the stored duration with the real video length.

Code:

- `webapp/src/pitch.ts`: pitch detection (YIN).
- `webapp/src/chords.ts`: voicings. Common chords use their open shapes, and every other chord uses the lowest E-shape or A-shape barre.
- `webapp/src/audio/`: chord playback.
  - `player.ts` is the only API the UI uses: `playChord`, `playNote`, `preload`, `setInstrument`, `setSource`.
  - `strum.ts` turns a fingering into timed notes: low→high or high→low, 25 ms apart, velocity 70–85, with ±5 ms and ±5 velocity of human variation.
  - `sources.ts` holds the `NoteSource` interface. The default source is the steel-string guitar soundfont via [smplr](https://github.com/danigb/smplr), loaded from gleitz.github.io (~1.8 MB, once per session). Each note passes its string and fret, so recorded `samples/{string}-{fret}.mp3` files can replace it through `setSource()`.
- `webapp/src/songs.ts`: the song data.

Tests: `npm test`. They check:

- pitch detection on synthetic string tones;
- that every one of the 108 voicings sounds only chord tones, with the root lowest;
- that every song chord is playable in every transposition;
- notation, using the same cases as `common/tests/test_notation.py`.

### Running the bot

```bash
# in another terminal, from the repo root; uses the same .env and database
uv run python -m chordb_bot.main
```

Then message your bot in Telegram and send `/start`. You should see:

- A greeting with your first name and a **🎸 Sozlashni boshlash** button that opens `WEBAPP_URL`.
- Your user row now has `bot_started_at` set.
- The chat's menu button (bottom left) is set to **Sozlash**. This only happens when `WEBAPP_URL` starts with `https://`.

Only one bot process may poll a token at a time. Stop the local bot before starting the one on the server, or use a separate test bot from @BotFather for local development.

### Calling the API without Telegram

`app.dev_init_data` prints initData signed with your real `BOT_TOKEN`. Validation is never bypassed.

```bash
cd backend
TMA=$(uv run python -m app.dev_init_data --id 1001 --first-name Bunyod)
curl -H "Authorization: tma $TMA" localhost:8001/api/me
curl -X PATCH -H "Authorization: tma $TMA" -H 'content-type: application/json' \
     -d '{"notation":"solfege"}' localhost:8001/api/me/settings
```

### Tests

```bash
docker compose --profile local exec postgres createdb -U chordb chordb_test   # once
uv run pytest            # from the repo root: common, backend and bot tests
```

The database tests run the real Alembic migrations against `TEST_DATABASE_URL`, and they **wipe that database**. If it can't be reached, those tests are skipped and the pure tests (initData, notation, rate limiter) still run. The bot tests feed real Telegram updates through the aiogram dispatcher with a mocked Telegram API, so they need no token or network.

### Everything in Docker

```bash
docker compose --profile local up --build
```

### Testing inside Telegram (HTTPS tunnel)

Telegram only opens Mini Apps over HTTPS, so expose your local server through a tunnel:

```bash
# Cloudflare quick tunnel: no account needed, gives a random https://*.trycloudflare.com URL
cloudflared tunnel --url http://localhost:5173      # Vite dev server; /api is proxied through it
# or: ngrok http 5173
```

1. Set `WEBAPP_URL` in `.env` to the tunnel URL.
2. In @BotFather, use `/mybots`, open your bot, then **Bot Settings → Configure Mini App** (or **Menu Button**) and paste the same URL.
3. Restart the bot (phase 2+), then open it in Telegram.

A quick tunnel's URL changes on every restart. Use a named Cloudflare tunnel or a reserved ngrok domain if you want a stable one.

## Production (chordb.shredzville.com)

The app runs on the shared VPS behind the existing Nginx:

- The backend listens on `127.0.0.1:8001`.
- Postgres is the existing container, bound to 127.0.0.1. ChordB uses its own `chordb` database.

### 1. Database (once)

```bash
docker exec -it <existing-postgres-container> psql -U postgres
```
```sql
CREATE ROLE chordb LOGIN PASSWORD '<strong-password>';
CREATE DATABASE chordb OWNER chordb;
```
The existing container must publish its port as `127.0.0.1:5432:5432`. Check with `docker ps`.

### 2. Code and config

```bash
git clone git@github.com:<you>/chordb.git /opt/chordb
cd /opt/chordb
cp .env.example .env && chmod 600 .env
# BOT_TOKEN=..., ENV=prod, WEBAPP_URL=https://chordb.shredzville.com
# DATABASE_URL=postgresql+asyncpg://chordb:<strong-password>@127.0.0.1:5432/chordb
```

### 3. Run

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
curl -s 127.0.0.1:8001/api/healthz      # {"status":"ok"}
docker compose logs -f bot              # "menu button -> https://chordb.shredzville.com"
```
The backend applies migrations (`alembic upgrade head`) on start, and the bot starts once the backend is healthy. The prod override drops the bundled Postgres and uses host networking, so `127.0.0.1` in `DATABASE_URL` refers to the VPS itself.

### 4. Webapp build

Nginx serves the static build from `webapp/dist`. Node 20 or newer must be installed on the VPS:

```bash
cd /opt/chordb/webapp && npm ci && npm run build
```

### 5. Nginx and TLS

```bash
sudo cp deploy/nginx-chordb.conf /etc/nginx/sites-available/chordb
sudo ln -s /etc/nginx/sites-available/chordb /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d chordb.shredzville.com
```

### Updating

```bash
cd /opt/chordb && git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
(cd webapp && npm ci && npm run build)
```

## Notifications

`chordb_bot/notify.py` handles all messages the bot sends on its own:

- `Notifier.send_to_user(telegram_id, text, button=None)` sends to one user.
- `Notifier.broadcast(users, text_or_fn, button=None)` sends to many users.

Every send:

- is spaced to at most **25 msg/s** across all concurrent senders;
- on **429**, pauses everyone for `retry_after` and retries (up to 3 tries);
- on **403** (user blocked the bot), sets `users.is_blocked_bot = true`;
- is logged in the `notifications` table with `user_id`, `type`, `status` (`sent`, `blocked` or `failed`), `sent_at`, `error` and `telegram_message_id`.

If the user blocks or unblocks the bot, Telegram sends a `my_chat_member` update and `is_blocked_bot` is updated right away. `/start` also clears the flag.

Scheduled jobs (time zone `NOTIFY_TZ`, default `Asia/Tashkent`):

| Job | When | Who |
|---|---|---|
| Welcome follow-up | every 15 min | Signed up 24h–7d ago, never opened the tuner, never got this message |
| Weekly reminder | Sunday 19:00 | `notifications_enabled`. The message has a **🔕 Eslatmalarni oʻchirish** button that turns reminders off. |

Both jobs only target users the bot may message: those who pressed `/start` or granted write access in the Mini App, and who haven't blocked the bot. Already-sent rows in `notifications` keep a restart from sending anything twice.

Test them by hand:

```bash
uv run python -m chordb_bot.cli send <your_telegram_id> "Salom!" --button
uv run python -m chordb_bot.cli run-job weekly        # sends the weekly reminder now
uv run python -m chordb_bot.cli run-job welcome
uv run python -m chordb_bot.cli broadcast "Yangilik!" # dry run; add --yes to send
```

Inspect the log with `psql … -c "select * from notifications order by id desc limit 20"`.

## Notation

Notes and chords are stored in a canonical form: a pitch class from 0 to 11, plus a chord quality. `chordb_common/notation.py` is the only code that turns them into text, based on the user's setting:

| Canonical | letter | solfège |
|---|---|---|
| A minor | `Am` | `Lya minor` |
| G dominant 7 | `G7` | `Sol 7` |
| F♯ minor | `F#m` | `Fa diyez minor` |
| B♭ major | `Bb` | `Si bemol major` |

The pitch classes map as C=Do, D=Re, E=Mi, F=Fa, G=Sol, A=Lya, B=Si.
