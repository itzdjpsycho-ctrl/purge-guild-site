@echo off
title Purge Bot Control - launcher
cd /d "%~dp0"

echo ============================================
echo   Purge Bot Control
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

REM --- Check npm is installed ---
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm is not on your PATH ^(it normally ships with Node.js^).
  echo         Try reinstalling Node.js from https://nodejs.org.
  echo.
  pause
  exit /b 1
)

REM --- Check dependencies are installed ---
if not exist "node_modules" (
  echo First-time setup: installing dependencies ^(this pulls down Electron, may take a minute^)...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed. See the output above for details.
    echo.
    pause
    exit /b 1
  )
  echo.
)

echo Opening the control panel window...
echo.

REM "start """" ..." launches Electron as its own detached process (not a
REM child of this console), so it keeps running after this launcher window
REM closes — you don't need to babysit a cmd window for the app to stay up.
REM Calling electron.exe directly (not the npm-generated electron.cmd shim)
REM avoids "start" spawning an extra visible cmd /K window to run the shim.
REM App path is "." (cwd is already this folder, from "cd /d" above) rather
REM than a quoted "%~dp0" — %~dp0 always ends in a backslash, and a trailing
REM backslash right before a closing quote is parsed as an escaped quote,
REM corrupting the argument and making Electron fail to find the app.
start "" "%~dp0node_modules\electron\dist\electron.exe" "."

REM Give it a couple seconds so a hard failure (corrupt install, etc.) still
REM shows up here before the window vanishes, instead of failing silently.
timeout /t 2 /nobreak >nul
exit /b 0
