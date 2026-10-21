# Stops the API, webapp dev server, bot and tunnel (wherever they were started from), then local Postgres.
# Usage:  powershell -ExecutionPolicy Bypass -File stop.ps1 [-KeepPostgres]
param(
    [switch]$KeepPostgres  # start.ps1 uses this to restart everything else cleanly
)

# --- API, webapp and bot ------------------------------------------------------
$patterns = @{
    'API'    = 'uvicorn app\.main:app'
    'Bot'    = 'chordb_bot\.main'
    'Worker' = 'app\.worker'
    'Webapp' = "ChordB Web'|vite[\\/]bin[\\/]vite\.js"
    'Tunnel' = "ChordB Tunnel'|cloudflared(\.exe)?`"? tunnel"
}

$procs = Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID }

foreach ($name in $patterns.Keys) {
    $matched = @($procs | Where-Object { $_.CommandLine -match $patterns[$name] })
    $ids = $matched.ProcessId
    # Kill only the top of each tree (the window's powershell, or uv); /T takes the
    # children with it, including uvicorn's reload worker.
    $roots = @($matched | Where-Object { $ids -notcontains $_.ParentProcessId })
    if ($roots.Count -eq 0) {
        Write-Host "${name}: not running"
        continue
    }
    foreach ($p in $roots) {
        taskkill /PID $p.ProcessId /T /F *> $null
    }
    Write-Host "${name}: stopped" -ForegroundColor Green
}

# --- Postgres -----------------------------------------------------------------
if ($KeepPostgres) { return }
$pgHome = Join-Path $env:LOCALAPPDATA 'chordb-pg'
$pgCtl  = Join-Path $pgHome 'venv\Lib\site-packages\pgserver\pginstall\bin\pg_ctl.exe'
$pgData = Join-Path $pgHome 'data'

& $pgCtl -D $pgData status *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Postgres: not running'
} else {
    & $pgCtl -D $pgData stop -m fast *> $null
    if ($LASTEXITCODE -eq 0) {
        Write-Host 'Postgres: stopped' -ForegroundColor Green
    } else {
        Write-Host 'Postgres: failed to stop' -ForegroundColor Red
    }
}
