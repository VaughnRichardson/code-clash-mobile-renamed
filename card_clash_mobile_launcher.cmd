@echo off
setlocal EnableExtensions

rem Card Clash mobile/web launcher.
rem Run this file from Explorer or PowerShell. Keep this window open while testing.

cd /d "%~dp0"
set "PROJECT_ROOT=%~dp0"
set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"
set "PYTHON_CMD=C:\Users\lavon\AppData\Local\Programs\Python\Python314\python.exe"

if not exist "%NPM_CMD%" (
  where npm.cmd >nul 2>&1
  if errorlevel 1 (
    echo Node.js/npm was not found. Install Node.js, then run this launcher again.
    pause
    exit /b 1
  )
  set "NPM_CMD=npm.cmd"
)

if not exist "%PYTHON_CMD%" (
  where python.exe >nul 2>&1
  if errorlevel 1 (
    echo Python was not found. Install Python 3.11 or newer, then run this launcher again.
    pause
    exit /b 1
  )
  set "PYTHON_CMD=python.exe"
)

where ngrok.exe >nul 2>&1
if errorlevel 1 (
  echo ngrok was not found on PATH. Install it and authenticate it with:
  echo   ngrok config add-authtoken YOUR_NGROK_TOKEN
  pause
  exit /b 1
)

if not exist "client\node_modules" (
  echo Installing client dependencies...
  pushd client
  call "%NPM_CMD%" install
  if errorlevel 1 goto :failed
  popd
)

echo Building Card Clash...
pushd client
call "%NPM_CMD%" run build
if errorlevel 1 goto :failed
popd

echo Starting Card Clash server on http://0.0.0.0:8000 ...
start "Card Clash Server" powershell.exe -NoProfile -ExecutionPolicy Bypass -NoExit -Command ^
  "Set-Location -LiteralPath '%PROJECT_ROOT%'; & '%PYTHON_CMD%' -m uvicorn server.app:app --host 0.0.0.0 --port 8000"

timeout /t 2 /nobreak >nul

echo.
echo Starting ngrok. Share the HTTPS forwarding URL with your players.
echo Press Ctrl+C here to stop ngrok. Close the Card Clash Server window when finished.
echo.
ngrok http 8000
exit /b 0

:failed
popd 2>nul
echo.
echo Card Clash could not be built or installed.
pause
exit /b 1
