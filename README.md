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
| GET | `/api/me` | Profile, `settings`, `needs_write_access`, `is_premium`, `premium_until`, and `start_song_id` when opened through a song link |
| PATCH | `/api/me/settings` | `{"notation": "letter" \| "solfege", "notifications_enabled": bool}`. Either field can be omitted. |
| POST | `/api/me/events` | `{"type": "tuner_opened" \| "write_access_requested" \| "write_access_granted" \| "premium_viewed"}` |
| GET | `/api/payments` | `{card, card_holder, plans[], latest}`: where to pay, the plans, and the user's latest payment |
| POST | `/api/payments` | Multipart `plan` (`month` \| `year`) and `receipt` (an image, ≤ 5 MB). **409** `already_pending` while one is waiting. Admins get a bot alert. |
| GET | `/api/songs` | `?q=&easy=&uzbek=&no_capo=`. Returns `{continue_playing, songs[]}`, published songs only. Each song has `locked` and `chords_preview` (its first 4 distinct chords). |
| GET | `/api/songs/{id}` | Song with `youtube_id`, `sections`, `events`, `position_sec`. A locked premium song gets **403** with `detail = {code: "premium_required", paywall: true, song}`. |
| PUT | `/api/songs/{id}/progress` | `{"position_sec": 61.5}`. Feeds `continue_playing`. |
| POST | `/api/analyze` | Chord detection. Multipart `file` (audio/video, ≤ 50 MB) **or** JSON `{"youtube_url"}`. **202** with a queued job, or **200** with a finished cache hit. See [Chord detection](#chord-detection). |
| GET | `/api/analyze/{id}` | Status, plus `key`, `bpm`, `beats`, `events` once `status = done`. Only the owner can read it. |
| GET | `/api/analyze/history` | `{remaining_today, daily_limit, items[]}`: the user's last 20, newest first |
| GET | `/api/healthz` | Liveness |

Chords are always canonical: `{"root": 0..11, "quality": "maj"|"min"|"7"|"maj7"|"m7"|"dim"|"aug"|"sus2"|"sus4"}`. The webapp renders them in the user's notation.

Admin endpoints accept only the Telegram ids in `ADMIN_IDS`. `/api/me` reports `is_admin` and `is_premium`. Premium here is ChordB's own, not Telegram Premium: `users.is_premium` (no end date) or `users.premium_until` (a paid or granted period).

| Method | Path | |
|---|---|---|
| GET | `/api/admin/songs` | All songs, drafts included |
| POST | `/api/admin/songs` | Create a draft: `title, artist, youtube_id, key, capo, difficulty, language, is_premium, duration_sec` |
| PATCH | `/api/admin/songs/{id}` | Update any of those fields |
| PUT | `/api/admin/songs/{id}/events` | `{sections: [{title, start_sec}], events: [{time_sec, root, quality}]}`. Replaces the whole timeline. Each event belongs to the last section that starts at or before it. |
| PATCH | `/api/admin/songs/{id}/publish` | `{"is_published": true}`. Requires at least one chord event. |
| GET | `/api/admin/songs/{id}/link` | `{url, opened, paid}`: the t.me song link and how many came (and paid) through it |
| GET | `/api/admin/stats` | `?period=today\|7d\|30d`. Headline numbers, sign-ups per day (14 days), the funnel, pending payments, catalog requests |
| GET | `/api/admin/users` | `?filter=all\|premium\|active_free\|pending\|blocked&q=&offset=`. `{counts, total, items[]}`, 50 per page |
| GET | `/api/admin/users/{id}` | The user, activity stats, pending payment, payments and premium history |
| POST | `/api/admin/users/{id}/premium` | `{"days": 30 \| null, "note"}`: adds days after what they have; `null` = no end date. The bot tells the user. |
| POST | `/api/admin/users/{id}/premium/revoke` | `{"note"}` |
| GET | `/api/admin/payments` | `?status=pending` (default, oldest first) \| `approved` \| `rejected` |
| GET | `/api/admin/payments/{id}/receipt` | The receipt image |
| POST | `/api/admin/payments/{id}/approve` | `{"days"?, "note"?}`: premium for the plan's days (or `days`). The bot tells the user. |
| POST | `/api/admin/payments/{id}/reject` | `{"note"?}`: the note is sent to the user as the reason |

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
- Tunes in one of four presets:
  - Standart (E A D G B E)
  - Yarim ton past (Eb Ab Db Gb Bb Eb)
  - Bir ton past (D G C F A D)
  - Drop D (D A D G B E)

  The choice is remembered on the device (`localStorage`, `tuning.ts`). It picks the nearest string automatically, or you can lock one string. A string counts as tuned once it stays within ±5 cents for 0.6 s.
- Reports `tuner_opened` when the microphone starts. After the first string is tuned it asks for write access, once (`needs_write_access`), and reports `write_access_requested` / `write_access_granted`.
- Follows Telegram's light or dark theme.

It has four tabs:

| Tab | What |
|---|---|
| Sozlash | The tuner: big note, cents meter, headstock with the six strings |
| Akkordlar | 12 roots × 9 qualities (maj, m, 7, m7, maj7, sus2, sus4, dim, aug) as chord diagrams. Tap one to hear it strummed. |
| Qoʻshiqlar | "Akkordlarni aniqlash" (automatic chord detection) and "Mening tahlillarim", then songs from the API: search, filters, "Davom ettirish", and a player with the YouTube video and its chords (see below) |
| Profil | Name, notation and weekly reminders |

Note and chord names everywhere follow the ABC / Do Re Mi setting.

The design specs for the songs screens are `webapp/*.reference.html`.

**Player.** The video plays through the official YouTube IFrame API, embedded, never downloaded. The player:

- reads the playback position every 100 ms and finds the current chord by binary search (`timeline.ts`);
- shows "Hozir" / "Keyingi" diagrams, a 4-beat bar (each chord event counts as one bar), and the sections grid, where tapping a bar seeks the video there;
- has Ton ±6 (changes the displayed chords only), Kapo (shapes shown relative to the capo), Tezlik 1/0.75/0.5× and loop of the current section;
- saves the position every 10 s and on pause or leave.

Videos whose owner disabled embedding (YouTube errors 101/150/153) show a message and a link to YouTube.

**Akkordlarni aniqlash** (top of Qoʻshiqlar). See [Chord detection](#chord-detection) for the backend.

- **"YouTube havola"** opens a link field with a "Qoʻyish" (paste) button. The link is checked by the server, so `youtu.be/…` without `https://` works too.
- **"Galereyadan"** is an `<input type="file" accept="audio/*,video/*">`. The upload shows its real progress (XHR).
- **Waiting:** while the job is queued or running, the card polls `GET /api/analyze/{id}` every 2 s. When it's done, the result opens in the song player. A cache hit opens at once.
- **Errors:** failed jobs and refused requests show an Uzbek message for their `error_code`. For a YouTube `blocked`/`unknown` failure it's *"YouTube'dan yuklab boʻlmadi. Videoni faylga saqlab, «Galereyadan» orqali yuklang."* The mapping is in `webapp/src/analysis.ts`, the texts in `texts.ts`.
- **Free analyses left today** show under the actions; "Cheksiz tahlil" for premium users and admins.
- **"Mening tahlillarim"** shows the last 3 analyses with "Hammasini koʻrsatish" for all 20. A job still running when you come back to the screen is picked up again.

**Analysed results** open in the same player (`AnalysisPlayer.tsx` builds the player's model), with an "Avtomatik" badge and a note that the chords may contain errors.

- **Media:** a YouTube result plays the embed. An uploaded file plays from the user's own file through an `<audio>` element (an object URL, `localAudio.ts`), synced the same way.
- **Files after a reload:** the browser only keeps the file for the session. After a reload, the player asks to pick the file again ("Faylni tanlash"); the chords show either way.
- **Chunks and beats:** analyses have no sections, so the grid and the section loop use chunks of 8 chord changes ("1-qism", "2-qism", …). The beat bar follows the detected beats.
- **No chord:** shown as "—".
- **Controls:** Ton, Kapo, Tezlik (the pitch is kept at 0.75× and 0.5×), loop and ABC / Do Re Mi work as for songs. Progress isn't saved for analyses.
- **Tuning switch:** when the engine reports `alt_tuning`, a switch offers two ways to show the chords:
  - **"Standart sozlash"** shows the chords as they sound, e.g. Fm Bbm Eb Ab.
  - **"Yarim ton past"** / **"Bir ton past"** shows the shapes in that tuning, e.g. F#m Bm E A. It's the default, since covers are tabbed that way. Its "Tyunerni ochish" opens the tuner already in that preset, and the Qoʻshiqlar tab brings you back to the same song.
- **Capo hint:** with `suggested_capo`, standard tuning also shows "Kapo 1 bilan osonroq: Em Am D G" and a button that sets the capo.

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
- `webapp/src/useVideo.ts`: the player hook. Its media is `{kind: "youtube", id}` or `{kind: "file", url}`. `localAudio.ts` gives an `<audio>` element the YouTube player's interface and state codes.
- `webapp/src/analysis.ts`: analysis error texts, titles, the in-session file registry, and turning an analysis into the player's timeline.

Tests: `npm test`. They check:

- pitch detection on synthetic string tones;
- that every one of the 108 voicings sounds only chord tones, with the root lowest;
- that every song chord is playable in every transposition;
- notation, using the same cases as `common/tests/test_notation.py`;
- analysis chunks, beat counting and error texts (`timeline.test.ts`, `analysis.test.ts`).

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
docker compose logs -f worker           # "worker ready"
```
The backend applies migrations (`alembic upgrade head`) on start. The bot and the chord-detection worker start once the backend is healthy. The backend and worker share the `media` volume. The prod override drops the bundled Postgres and uses host networking, so `127.0.0.1` in `DATABASE_URL` refers to the VPS itself.

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

Certbot edits the live file. On a server that already has TLS, don't copy the file over again. Instead, add any new `location` blocks from `deploy/nginx-chordb.conf` by hand. For example, `location = /api/analyze` raises the upload limit to 51 MB. Then run `sudo nginx -t && sudo systemctl reload nginx`.

### Updating

```bash
cd /opt/chordb && git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
sh deploy/ytdlp-update.sh        # a rebuild resets yt-dlp to uv.lock's version
(cd webapp && npm ci && npm run build)
```

## Admin panel and premium

The admin panel is a page of the same webapp at `/admin` (`webapp/src/panel/`, designs in `docs/design/`). It uses the same initData login, so it opens inside Telegram: send `/admin` to the bot (it answers admins only) and open it in **Telegram Desktop**, where the panel goes full-window. Admins also find it at the bottom of the Profile tab. Pages:

- **Panel**: users, premium, active, revenue this month, sign-ups per day, the funnel (opened → tuner → song → premium sheet → payment sent → approved), payments waiting, and songs people looked for but the catalog lacks (searches that found nothing and YouTube analyses of songs not in the catalog, last 30 days).
- **Toʻlovlar / Foydalanuvchilar**: search and filter users, review a receipt, approve or reject, grant or revoke premium, and see the history.
- **Qoʻshiqlar**: paste a YouTube link, run the automatic analysis, check the chords (low-confidence ones are dashed), fill in the details and save or publish. The chord editor fixes timings. Each saved song gets a `t.me/<BOT_USERNAME>/<WEBAPP_SHORT_NAME>?startapp=song_<id>` link for Instagram, which opens the Mini App on that song.

Premium is paid by card transfer. In the Mini App's premium sheet (a locked song, or Profile → Premium olish), the user picks 30 days (`PREMIUM_PRICE_MONTH`) or a year (`PREMIUM_PRICE_YEAR`), pays to `PAYMENT_CARD` and uploads the receipt screenshot. The receipt is stored in Postgres (`payments.receipt`), and admins get a bot alert. Approving adds the days after any premium the user still has. Approving, rejecting (with the reason) and granting all message the user through the bot. Without `PAYMENT_CARD`, the sheet says premium is coming soon.

Activity behind the stats is in `user_events`, at most one row per user, type and day (`NOTIFY_TZ`): `app_opened` (each `/api/me`), `tuner_opened`, `song_opened`, `premium_viewed` and `deep_link`.

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

## Chord detection

`backend/app/analysis/` guesses the key, tempo, beats and chord timeline of any local audio or video file. It uses DSP only, with no machine-learning models. It knows 12 major and 12 minor triads plus `N` (no chord).

| File | What |
|---|---|
| `audio.py` | ffprobe rejects files over 10 min. ffmpeg then decodes to mono 22.05 kHz. Every failure raises `AnalysisError(code)`. |
| `engine.py` | HPSS, beat tracking on the percussive part, and beat-synchronous `chroma_cqt` on the harmonic part. Very quiet frames are ignored. Stretches with no tracked beats are padded at the median beat period. |
| `decode.py` | Cosine similarity to binary triad templates. A Krumhansl-Kessler key estimate and a key prior: diatonic chords ×1.5, others ×0.9. In minor keys the major V (E in Am) counts as diatonic. Viterbi smoothing (self-transition 0.85), then merging equal neighbours and dropping segments shorter than one beat. |
| `tuning.py` | Which tuning and capo the song was most likely played in (see below) |
| `evaluate.py` | Beat-level accuracy against `analysis_eval/*.json`, with and without the key prior |
| `synth.py` | Synthetic songs with exact ground truth, for the tests |

The result has `key`, `bpm`, `beats`, `duration_sec`, `engine_version`, and `events: [{start_sec, end_sec, chord: {root, quality} | null, confidence}]`. `null` means no chord. It also has `tuning_offset_cents`, `alt_tuning` and `suggested_capo`, described under "Tuning" below. Bump `ENGINE_VERSION` (in `app/analysis/__init__.py`, now 1.1) whenever the output would change; older cached results are then recomputed.

**Tuning.** Covers often sound exactly one semitone off from the chord sheet: a guitar tuned a half step down sounds Fm Bbm Eb Ab when the player fingers F#m Bm E A. The two are physically the same sound, so this can't be measured. It is decided instead:

1. **Sub-semitone drift** (±50 cents, e.g. a guitar 30 cents flat or a slightly sped-up upload): `librosa.estimate_tuning` runs on the harmonic part, and the result is passed to `chroma_cqt(tuning=…)`. The result reports it as `tuning_offset_cents`.
2. **Whole semitones** (`tuning.py`): every chord gets a shape-ease score (open chords 1.0, common barres 0.4–0.6, awkward ones 0.2), weighted by duration.
   - If the shapes a half or a whole step down are clearly easier (+0.25, and at least 0.6 overall), the result has `alt_tuning = {"name": "Eb standard", "shift": -1}`, or `D standard` / `-2`.
   - Events stay at sounding pitch; the shapes in that tuning are each chord moved up by `-shift`.
   - `suggested_capo` is the lowest capo that makes standard-tuning shapes clearly easier (+0.15), for example Fm Bbm Eb Ab with capo 1 gives Em Am D G.

```bash
cd backend
uv run python -m app.analysis.cli path/to/song.mp3                    # key, bpm, timeline
uv run python -m app.analysis.cli song.mp4 --notation solfege --no-key-prior
uv run python -m app.analysis.cli song.mp3 --json

uv run python -m app.analysis.synth ../analysis_eval                  # once: synthetic_am.wav
uv run python -m app.analysis.evaluate                                # every song in analysis_eval/
uv run python -m app.analysis.evaluate --self-transition 0.9 --key-boost 2
```

The evaluation prints, per song:

- `tune`: the corrected tuning offset in cents.
- `alt`: the down-tuning detected (Eb or D).
- `exact`: accuracy at sounding pitch.
- `best±2`: transposition-invariant accuracy, the best over whole-song shifts of −2..+2, with that shift.
- `no prior`: exact accuracy without the key prior.

A low `exact` with a high `best±2` means the chords are right and only the tuning is shifted:

```
song                              key  tune  alt  exact      best±2  no prior
Synthetic eb_standard               B   +1c   Eb   4.5% 100.0% (+1)      4.5%
Synthetic flat_30c                  C  -28c    - 100.0% 100.0% (+0)    100.0%
```

See `analysis_eval/README.md` for the ground-truth format. The audio files there are gitignored.

A 10-minute song takes about 50 s on a desktop CPU, almost all of it HPSS.

### Jobs and API

`POST /api/analyze` checks the cache and the free daily limit, then queues a row in `analyses` (status `queued`).

- **Uploads:** streamed into `MEDIA_DIR` while being hashed (sha256).
- **YouTube:** `youtube.com/watch`, `youtu.be`, `shorts` and `embed` links all reduce to the 11-character video id.

| Rule | |
|---|---|
| Cache | A finished result with the same `youtube_id` or `file_hash` and the current `ENGINE_VERSION` is copied into a new row for this user (`cache_hit = true`) and returned at once, with no job. |
| Duplicates | The same media while the user's own job is still queued or running returns that job. |
| Daily limit | `ANALYZE_FREE_PER_DAY` (3) new analyses per day in `NOTIFY_TZ`. Failed analyses and cache hits don't count. Premium users (`users.is_premium`) and admins are unlimited. Over the limit: **429** `{"code": "daily_limit", "limit": 3}`. |
| Uploads | ≤ `ANALYZE_MAX_UPLOAD_MB` (50), otherwise 413 `file_too_large`. The MIME type must be `audio/*` or `video/*`; a missing or `application/octet-stream` type is accepted when the extension is a known audio/video one. Anything else gets 415 `unsupported_type`. |
| Media | Deleted as soon as the job ends, whatever the outcome. Only the result is stored. |

Errors use `detail = {"code": ...}`. The codes on a failed job (`error_code`) are:

- `decode_failed`: not an audio/video file ffmpeg can read
- `too_long`: over 10 min
- `too_short`
- `timeout`
- `crashed`
- `interrupted`: the file was lost during a worker restart
- `ffmpeg_missing`
- `unknown`
- YouTube only: `blocked`, `private_or_removed`, `not_found` (see below)

The webapp turns these codes into Uzbek text, the same way it handles `premium_required`.

### YouTube links

The worker downloads **audio only** (`bestaudio`) with the yt-dlp Python API, into `MEDIA_DIR/yt-<id>/`. The worker deletes that folder when the job ends, even if the job's process was killed. The download counts toward the job's 180 s timeout.

- **10-minute limit:** checked from the video's metadata before anything is downloaded. Live streams count as `too_long`.
- **No cookies:** personal account cookies are never used. There's no `cookiefile` or cookies-from-browser, and the Python API reads no yt-dlp config files.
- **JS challenges:** YouTube's challenges are solved with Deno. The `yt-dlp[deno]` extra installs it from PyPI (MIT), so there's nothing to install by hand, on Windows or in the Docker image.
- **Title:** the video's title is saved in `analyses.title` for the history list.

yt-dlp's error messages map to `error_code`. The first match wins:

| Code | When | Message the user sees |
|---|---|---|
| `private_or_removed` | Private, removed, terminated account, members-only | Video is private or removed |
| `blocked` | "Sign in to confirm you're not a bot", age-restricted, not available in your country, HTTP 403/429 | *YouTube'dan yuklab boʻlmadi. Videoni faylga saqlab, «Galereyadan» orqali yuklang.* |
| `not_found` | "Video unavailable", bad id, HTTP 404, an upcoming premiere | Video not found |
| `too_long` | Over 10 min, or live | Over 10 minutes |
| `unknown` | Anything else | Same message as `blocked` |

**Alert.** If 3 YouTube downloads in a row fail with `blocked` or `unknown`, the worker sends one short Telegram message to every id in `ADMIN_IDS`, and logs `event=youtube_alert`.

- Any successful download, or an answer like `not_found`, `private_or_removed` or `too_long` (YouTube answered, so downloading works), resets the count. Upload failures never count.
- The count lives in memory, so a restart resets it.
- Admins must have pressed `/start` in the bot, or Telegram refuses the message. The worker logs `alert to … failed: HTTP 403`.

**Daily yt-dlp update.** YouTube changes often and yt-dlp follows within days, so on the server a systemd timer updates yt-dlp, yt-dlp-ejs and deno inside the worker container every night at about 04:30. The worker restarts only when the version changed, and the jobs it was running are requeued.

The worker's venv is uv-managed and has no pip, so the script runs `uv pip install -U yt-dlp yt-dlp-ejs deno`, uv's equivalent of `pip install -U yt-dlp`.

```bash
sudo cp deploy/chordb-ytdlp-update.service deploy/chordb-ytdlp-update.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now chordb-ytdlp-update.timer
sudo systemctl start chordb-ytdlp-update      # run it once now
journalctl -u chordb-ytdlp-update             # "yt-dlp update: 2026.08.19 -> 2026.10.02 (worker restarted)"
systemctl list-timers chordb-ytdlp-update     # next run
```

Rebuilding the image resets yt-dlp to the version in `uv.lock`, so `Updating` runs the script after each deploy. To move the lock forward too:

```bash
uv lock --upgrade-package yt-dlp --upgrade-package yt-dlp-ejs --upgrade-package deno && uv sync --all-packages
```

Run that locally as well; it's how the dev setup gets updates.

The real-network test downloads a 19 s public video ("Me at the zoo"): `CHORDB_NETWORK_TESTS=1 uv run pytest backend/tests/test_youtube.py`.

### The worker

```bash
cd backend
uv run python -m app.worker      # Ctrl+C to stop
```

Run **exactly one** worker per database. It runs `ANALYZE_CONCURRENCY` (2) jobs at a time, each in its own long-lived process. Each process imports librosa and warms numba up once at start, about 5 s, so jobs don't pay for it.

- **Timeout:** a job that takes longer than `ANALYZE_TIMEOUT_SEC` (180) has its process killed and replaced. It fails with `timeout`.
- **Queue:** the `analyses` table itself. A job is claimed with `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)`. A new job starts within about 1 s.
- **Restarts:** on start, the worker requeues jobs a previous worker left `running`. Uploads whose file is gone fail with `interrupted`.
- **Stray files:** every 10 min it deletes files in `MEDIA_DIR` that are older than 10 min and that no job points at.

The API and the worker must use the same `MEDIA_DIR`. Locally both default to `<temp>/chordb-media`, and in Docker both mount the `media` volume.

Each event is one log line from the `chordb.events` logger: `event=analyze_request|analyze_done|analyze_failed analysis_id=… user_id=… source=… …`.

- `analyze_failed` adds `error_code`.
- `analyze_done` adds `ms`, `wait_ms`, `bpm`, and `cache_hit=True` for cache hits.

On the server: `docker compose logs backend worker | grep event=`.

Try it locally:

```bash
cd backend
TMA=$(uv run python -m app.dev_init_data --id 1001 --first-name Bunyod)
curl -H "Authorization: tma $TMA" -F "file=@song.mp3" localhost:8001/api/analyze      # {"id": 1, "status": "queued", …}
curl -H "Authorization: tma $TMA" -H 'content-type: application/json' \
     -d '{"youtube_url": "https://youtu.be/jNQXAC9IVRw"}' localhost:8001/api/analyze
curl -H "Authorization: tma $TMA" localhost:8001/api/analyze/1
curl -H "Authorization: tma $TMA" localhost:8001/api/analyze/history
```

### ffmpeg

ffmpeg is a system dependency. Both `ffmpeg` and `ffprobe` must be on `PATH`.

- **Windows:** `winget install Gyan.FFmpeg`, then open a new terminal and check with `ffmpeg -version`. Or download the "release essentials" build from https://www.gyan.dev/ffmpeg/builds/ and add its `bin` folder to `PATH`.
- **Ubuntu server:** `sudo apt update && sudo apt install -y ffmpeg`, then `ffmpeg -version`.

Without ffmpeg the analysis fails with `ffmpeg_missing`, and the one test that decodes real files is skipped.

### Licenses

All the Python dependencies allow commercial use:

- librosa (ISC)
- numpy, scipy, soundfile, scikit-learn, joblib, pooch, threadpoolctl (BSD)
- numba, llvmlite (BSD / Apache-2.0)
- msgpack (Apache-2.0)
- soxr (LGPL-2.1+): used unmodified as a dynamically loaded library, which LGPL allows in closed-source products
- yt-dlp (Unlicense), yt-dlp-ejs (Unlicense/MIT/ISC), deno (MIT)
- httpx, httpcore, idna (BSD), anyio, h11 (MIT), certifi (MPL-2.0)
- python-multipart (Apache-2.0)

yt-dlp's `default` extra is deliberately not installed: it would pull in mutagen (GPL), which ChordB doesn't need.

ffmpeg runs as a separate program and is never linked.
