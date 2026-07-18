@echo off
setlocal

REM ============================================================
REM Build web/dist and deploy to VPS mobile directory
REM ============================================================

set VPS=root@106.15.11.158
set VPS_MOBILE_DIR=/root/server-auth/mobile

echo.
echo === [1/3] Building web/dist ===
cd /d "%~dp0web"
if errorlevel 1 (
    echo [ERROR] web directory not found
    pause
    exit /b 1
)

call npm run build
if errorlevel 1 (
    echo [ERROR] npm run build failed
    pause
    exit /b 1
)

echo.
echo === [2/3] Cleaning VPS old files ===
ssh -o ConnectTimeout=15 -o ServerAliveInterval=5 -o ServerAliveCountMax=3 %VPS% "rm -rf %VPS_MOBILE_DIR%/*"
if errorlevel 1 (
    echo [ERROR] SSH cleanup failed
    pause
    exit /b 1
)

echo.
echo === [3/3] Uploading dist/* to VPS ===
scp -r dist/* %VPS%:%VPS_MOBILE_DIR%/
if errorlevel 1 (
    echo [ERROR] SCP upload failed
    pause
    exit /b 1
)

echo.
echo === Done ===
echo VPS dir: %VPS_MOBILE_DIR%
echo URL: http://106.15.11.158:3456/mobile/
echo.
pause
