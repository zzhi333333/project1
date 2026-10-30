@echo off
rem Legal Assistant - one-click launcher
rem Auto-detects Node.js: full server (online mode) if present, else offline static server.
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel%==0 (
  echo [OK] Node.js detected - starting FULL server with online mode...
  echo      flk.npc.gov.cn search + case search + AI proxy enabled.
  start "Legal Assistant Server (Node)" cmd /c "node "%~dp0server.js" & pause"
) else (
  echo [WARN] Node.js not found - starting OFFLINE static server only.
  echo        Install Node.js to enable online search and AI.
  start "Legal Assistant Server (Offline)" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Port 8080
)

timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:8080/
echo.
echo Browser will open at http://127.0.0.1:8080
echo A server window stays open - keep it running; close it to stop the server.
timeout /t 3 /nobreak >nul
