@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows.ps1" -Action Start
if errorlevel 1 (
  echo.
  echo Syncfly could not start. Read the error above, then try again.
  pause
  exit /b 1
)
