@echo off
setlocal
REM Double-click this file in Explorer to start the Room Flythrough Studio
REM (backend server + web UI) and open it in your browser automatically.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js wurde nicht gefunden.
  echo Bitte installiere Node.js ^(LTS-Version^) von https://nodejs.org/
  echo und starte dieses Skript danach erneut.
  echo.
  pause
  exit /b 1
)

node scripts\start-studio.mjs

echo.
echo Der Server wurde beendet. Du kannst dieses Fenster jetzt schliessen.
pause
