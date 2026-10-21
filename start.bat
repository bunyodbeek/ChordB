@echo off
rem Double-click launcher for start.ps1 (passes any arguments through, e.g. -NoBot).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
pause
