@echo off
setlocal
set "VENV=C:\Users\%USERNAME%\.venvs\room-flythrough-prep"
set "PY="

where py >nul 2>&1 && set "PY=py -3.12"
if not defined PY where python >nul 2>&1 && set "PY=python"
if not defined PY (
  echo Python 3.12 nicht gefunden. Bitte installieren ^(winget install Python.Python.3.12^) und PATH neu laden.
  pause
  exit /b 1
)

echo Creating venv at %VENV% ...
%PY% -m venv "%VENV%"
if errorlevel 1 (
  echo venv fehlgeschlagen.
  pause
  exit /b 1
)

echo Installing requirements...
"%VENV%\Scripts\python.exe" -m pip install --upgrade pip
"%VENV%\Scripts\pip.exe" install -r "%~dp0requirements.txt"
if errorlevel 1 (
  echo pip install fehlgeschlagen.
  pause
  exit /b 1
)

echo.
echo Prep setup OK. Start with "Start Prep.bat"
pause
