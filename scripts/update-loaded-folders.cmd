@echo off
rem User-launched only; keep beside the reviewed PowerShell script. No policy bypass.
powershell.exe -NoProfile -File "%~dp0update-loaded-folders.ps1" %*
if errorlevel 1 (
  echo Update refused or failed. Preserve local work and read the error above.
  pause
  exit /b 1
)
pause
