# Starts everything needed to use the Mini App inside Telegram: local Postgres and
# migrations, then the API, worker, webapp dev server, an HTTPS tunnel and the bot, each
# in its own window. The tunnel's (new, random) URL goes into .env as WEBAPP_URL and onto
# the bot's menu button, so the bot always opens the running app.
# Anything already running is restarted first (Postgres is kept).
# Usage (from anywhere):
#   powershell -ExecutionPolicy Bypass -File start.ps1 [-NoBot] [-NoApi] [-NoWeb] [-NoWorker] [-NoTunnel]
param(
    [switch]$NoBot,
    [switch]$NoApi,
    [switch]$NoWeb,
    [switch]$NoWorker,
    [switch]$NoTunnel  # browser testing only: Telegram can't reach the app without it
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# Pick up git/python/uv even in shells opened before they were installed.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [Environment]::GetEnvironmentVariable('Path', 'User')

# --- Restart: stop whatever is already running (two APIs can't share a port, two bots
# fight over updates) --------------------------------------------------------------
# "Already gone" from taskkill is fine here, so don't let it stop this script.
$ErrorActionPreference = 'Continue'
& (Join-Path $root 'stop.ps1') -KeepPostgres *> $null
$ErrorActionPreference = 'Stop'

# --- Postgres -----------------------------------------------------------------
$pgHome = Join-Path $env:LOCALAPPDATA 'chordb-pg'
$pgBin  = Join-Path $pgHome 'venv\Lib\site-packages\pgserver\pginstall\bin'
$pgData = Join-Path $pgHome 'data'
$pgLog  = Join-Path $pgHome 'server.log'

if (-not (Test-Path (Join-Path $pgBin 'pg_ctl.exe'))) {
    throw "Postgres binaries not found in $pgBin"
}

& (Join-Path $pgBin 'pg_ctl.exe') -D $pgData status *> $null
if ($LASTEXITCODE -eq 0) {
    Write-Host 'Postgres: already running' -ForegroundColor Green
} else {
    Write-Host 'Postgres: starting...'
    # Launch through WMI so postgres.exe is fully detached. Started as our child, it
    # would inherit this script's stdout handle and keep it open for as long as
    # Postgres runs, hanging anything that pipes or captures this script's output.
    $cmd = "`"$(Join-Path $pgBin 'pg_ctl.exe')`" -D `"$pgData`" -l `"$pgLog`" " +
           "-o `"-p 5432 -c listen_addresses=127.0.0.1`" start"
    $res = Invoke-CimMethod Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd }
    if ($res.ReturnValue -ne 0) { throw "Could not launch pg_ctl (WMI code $($res.ReturnValue))" }

    $deadline = (Get-Date).AddSeconds(30)
    do {
        Start-Sleep -Milliseconds 500
        & (Join-Path $pgBin 'pg_isready.exe') -h 127.0.0.1 -p 5432 -q
    } until ($LASTEXITCODE -eq 0 -or (Get-Date) -gt $deadline)
    if ($LASTEXITCODE -ne 0) { throw "Postgres failed to start, see $pgLog" }
    Write-Host 'Postgres: started on 127.0.0.1:5432' -ForegroundColor Green
}

# --- Migrations ---------------------------------------------------------------
Write-Host 'Migrations: alembic upgrade head'
Push-Location (Join-Path $root 'backend')
try {
    uv run alembic upgrade head
    if ($LASTEXITCODE -ne 0) { throw 'Migrations failed' }
} finally {
    Pop-Location
}

# --- Webapp: deps and a fresh dev login -----------------------------------------
$web = Join-Path $root 'webapp'
if (-not $NoWeb) {
    if (-not (Test-Path (Join-Path $web 'node_modules'))) {
        Write-Host 'Webapp: npm install'
        Push-Location $web
        try { npm install --no-fund --no-audit; if ($LASTEXITCODE -ne 0) { throw 'npm install failed' } }
        finally { Pop-Location }
    }

    # Signed initData lets the webapp call the API from a plain browser. It expires
    # after 24h, so make a new one on every start. Inside Telegram it is ignored.
    Push-Location (Join-Path $root 'backend')
    try { $initData = uv run python -m app.dev_init_data --id 1001 --first-name Dev }
    finally { Pop-Location }
    if ($LASTEXITCODE -eq 0 -and $initData) {
        # No BOM: Vite would read it as part of the variable name.
        [IO.File]::WriteAllText((Join-Path $web '.env.local'),
            "VITE_DEV_INIT_DATA=`"$initData`"`n", (New-Object Text.UTF8Encoding $false))
        Write-Host 'Webapp: dev login written to webapp\.env.local' -ForegroundColor Green
    } else {
        Write-Host 'Webapp: could not make a dev login (ENV=prod?), browser testing will say "open in Telegram"' -ForegroundColor Yellow
    }
}

# --- API, webapp and bot, each in its own window --------------------------------
function Start-Window($title, $dir, $command) {
    $script = "`$Host.UI.RawUI.WindowTitle = '$title'; `$env:Path = '$env:Path'; $command"
    Start-Process powershell -WorkingDirectory $dir -ArgumentList '-NoExit', '-Command', $script
}

# --- HTTPS tunnel for Telegram ------------------------------------------------------
# Telegram opens Mini Apps only over HTTPS. A Cloudflare quick tunnel gives a new random
# URL each time, so write it to .env before the API and bot start (they read WEBAPP_URL).
$envFile = Join-Path $root '.env'
$tunnelUrl = $null
if (-not $NoTunnel -and -not $NoWeb) {
    $cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
    if (-not $cloudflared) {
        Write-Host 'Tunnel: cloudflared not found (winget install Cloudflare.cloudflared), Telegram login will not work' -ForegroundColor Yellow
    } else {
        $tunnelLog = Join-Path $env:LOCALAPPDATA 'chordb-tunnel.log'
        Remove-Item $tunnelLog -ErrorAction SilentlyContinue
        Start-Window 'ChordB Tunnel' $root "cloudflared tunnel --no-autoupdate --url http://localhost:5173 --logfile `"$tunnelLog`""
        $deadline = (Get-Date).AddSeconds(45)
        do {
            Start-Sleep -Milliseconds 500
            if (Test-Path $tunnelLog) {
                $m = Select-String -Path $tunnelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
                if ($m) { $tunnelUrl = $m.Matches[0].Value }
            }
        } until ($tunnelUrl -or (Get-Date) -gt $deadline)
        if ($tunnelUrl) {
            $lines = Get-Content $envFile -Encoding UTF8
            if ($lines -match '^WEBAPP_URL=') {
                $lines = $lines -replace '^WEBAPP_URL=.*$', "WEBAPP_URL=$tunnelUrl"
            } else {
                $lines += "WEBAPP_URL=$tunnelUrl"
            }
            [IO.File]::WriteAllLines($envFile, $lines, (New-Object Text.UTF8Encoding $false))
            Write-Host "Tunnel: $tunnelUrl (written to .env as WEBAPP_URL)" -ForegroundColor Green
        } else {
            Write-Host "Tunnel: no URL after 45 s, see $tunnelLog" -ForegroundColor Yellow
        }
    }
}

if (-not $NoApi) {
    Start-Window 'ChordB API' (Join-Path $root 'backend') 'uv run uvicorn app.main:app --reload --port 8001'
    Write-Host 'API: http://127.0.0.1:8001  (docs: /api/docs)' -ForegroundColor Green
}

if (-not $NoWorker) {
    if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
        Write-Host 'Worker: ffmpeg not found, analyses will fail (winget install Gyan.FFmpeg)' -ForegroundColor Yellow
    }
    Start-Window 'ChordB Worker' (Join-Path $root 'backend') 'uv run python -m app.worker'
    Write-Host 'Worker: chord detection (ready after ~10 s)' -ForegroundColor Green
}

if (-not $NoWeb) {
    Start-Window 'ChordB Web' $web 'npm run dev'
    Write-Host 'Webapp: http://localhost:5173' -ForegroundColor Green
}

if (-not $NoBot) {
    $token = (Select-String -Path (Join-Path $root '.env') -Pattern '^BOT_TOKEN=(.*)$').Matches.Groups[1].Value
    if (-not $token -or $token -like '*replace-me*') {
        Write-Host 'Bot: skipped, set a real BOT_TOKEN in .env first' -ForegroundColor Yellow
    } else {
        Start-Window 'ChordB Bot' $root 'uv run python -m chordb_bot.main'
        Write-Host 'Bot: started (long polling)' -ForegroundColor Green
    }
}

# --- Bot menu button -> the tunnel --------------------------------------------------
# The bot sets it on start too; doing it here as well means it is right the moment this
# script finishes, and the check below shows it.
if ($tunnelUrl -and -not $NoBot -and $token -and $token -notlike '*replace-me*') {
    $api = "https://api.telegram.org/bot$token"
    $body = @{ menu_button = @{ type = 'web_app'; text = 'Sozlash'; web_app = @{ url = "$tunnelUrl/" } } } |
        ConvertTo-Json -Depth 5 -Compress
    try {
        Invoke-RestMethod -Method Post -Uri "$api/setChatMenuButton" -ContentType 'application/json; charset=utf-8' `
            -Body ([Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
        $now = (Invoke-RestMethod -Uri "$api/getChatMenuButton").result.web_app.url
        $me = (Invoke-RestMethod -Uri "$api/getMe").result.username
        Write-Host "Telegram: open @$me and tap the menu button ($now)" -ForegroundColor Green
    } catch {
        # Never print the exception: its text contains the URL, i.e. the bot token.
        Write-Host 'Telegram: could not set the menu button (network?)' -ForegroundColor Yellow
    }
}
