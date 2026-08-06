@echo off
REM One-click Windows standalone build (must run ON Windows).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\standalone\build-windows.ps1"
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)
echo.
echo Fertig. Siehe Ordner dist-win\
pause
