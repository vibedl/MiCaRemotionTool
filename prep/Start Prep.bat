@echo off
setlocal
set "VENV=C:\Users\%USERNAME%\.venvs\room-flythrough-prep"
set "ROOT=%~dp0"

if not exist "%VENV%\Scripts\uvicorn.exe" (
  echo venv fehlt. Bitte zuerst "Setup Prep.bat" ausfuehren.
  pause
  exit /b 1
)

cd /d "%ROOT%"
echo Prep UI: http://localhost:4400
echo Studio bleibt separat: pnpm studio  →  http://localhost:5183
echo.
"%VENV%\Scripts\uvicorn.exe" app:app --host 0.0.0.0 --port 4400 --reload
