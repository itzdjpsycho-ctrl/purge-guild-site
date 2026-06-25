@echo off
title Purge War Lord - Discord Bot
cd /d "%~dp0"

echo ============================================
echo   Purge War Lord - Discord Bot
echo ============================================
echo.

REM --- Check Node is installed ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not on your PATH.
  echo         Download it from https://nodejs.org and try again.
  echo.
  pause
  exit /b 1
)

REM --- Check .env exists ---
if not exist ".env" (
  echo [ERROR] No .env file found in this folder.
  echo         Copy .env.example to .env and fill in your bot token + IDs.
  echo.
  pause
  exit /b 1
)

REM --- Check dependencies are installed ---
if not exist "node_modules" (
  echo First-time setup: installing dependencies...
  call npm install
  echo.
)

echo Starting the bot. Keep this window OPEN to stay online.
echo Close this window or press Ctrl+C to take the bot offline.
echo.

node src/index.js

REM --- If the bot stops/crashes, hold the window open so you can read why ---
echo.
echo ============================================
echo   The bot has stopped.
echo ============================================
pause
