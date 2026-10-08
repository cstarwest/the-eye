@echo off
rem Windows: double-click to start Gatekeeper. Closing this window closes the app.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Gatekeeper needs Node.js 22.12 or newer: https://nodejs.org
  pause
  exit /b 1
)
node desktop\launch.mjs %*
if errorlevel 1 pause
