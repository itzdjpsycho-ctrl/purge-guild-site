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

echo Opening the control panel window. This launcher window can stay open in the background.
echo.

call npm start
set "EXITCODE=%errorlevel%"

echo.
echo ============================================
echo   Control panel closed ^(exit code %EXITCODE%^).
echo ============================================
if not "%EXITCODE%"=="0" (
  echo If that closed unexpectedly, scroll up for the error above.
  echo.
)
pause
