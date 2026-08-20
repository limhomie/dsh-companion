@echo off
setlocal

where pwsh.exe >nul 2>nul
if "%ERRORLEVEL%"=="0" (
  pwsh.exe -NoLogo -NoProfile -File "%~dp0start-companion.ps1"
) else (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-companion.ps1"
)
set "companion_exit=%ERRORLEVEL%"

if not "%companion_exit%"=="0" (
  echo.
  echo DSH Companion failed to start with exit code %companion_exit%.
  pause
)

exit /b %companion_exit%
