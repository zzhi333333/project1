@echo off
rem Legal Assistant - one-click launcher
rem Starts the local server and opens the browser.
cd /d "%~dp0"
start "Legal Assistant Server" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Port 8080
timeout /t 1 /nobreak >nul
start "" http://127.0.0.1:8080/
echo Browser will open at http://127.0.0.1:8080
echo (A server window stays open - keep it, or close it to stop the server)
timeout /t 3 /nobreak >nul
