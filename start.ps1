# Starts local Postgres, applies migrations, then opens the API, the webapp dev server
# and the bot in their own windows.
# Usage (from anywhere):  powershell -ExecutionPolicy Bypass -File start.ps1 [-NoBot] [-NoApi] [-NoWeb] [-NoWorker]
param(
    [switch]$NoBot,
    [switch]$NoApi,
    [switch]$NoWeb,
    [switch]$NoWorker
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# Pick up git/python/uv even in shells opened before they were installed.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [Environment]::GetEnvironmentVariable('Path', 'User')

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
