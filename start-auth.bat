@echo off
echo ========================================
echo   SLG Auth Server - Docker Launch
echo ========================================
echo.

REM Check Docker
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker not running. Please start Docker Desktop first.
    pause
    exit /b 1
)
echo [OK] Docker is running

REM Stop & remove old container
docker rm -f slg-auth >nul 2>&1
if %errorlevel% equ 0 echo [OK] Old container removed

REM Build image
echo.
echo [BUILD] Building image...
docker build -t slg-auth-server "%cd%\server-auth"
if %errorlevel% neq 0 (
    echo [ERROR] Build failed
    pause
    exit /b 1
)
echo [OK] Image built

REM Run container
echo.
echo [RUN] Starting container...
docker run -d ^
  --name slg-auth ^
  -p 3456:3456 ^
  -v "%cd%\server-auth\auth.db:/app/auth.db" ^
  -e ADMIN_KEY=admin-change-me-in-production ^
  -e JWT_SECRET=jwt-secret-change-me-in-production-2025 ^
  slg-auth-server

if %errorlevel% neq 0 (
    echo [ERROR] Container failed to start
    pause
    exit /b 1
)

REM Verify
echo.
docker ps --filter name=slg-auth --format "table {{.Names}}{{.Status}}{{.Ports}}"

REM Test endpoint
echo.
echo [TEST] Testing health...
timeout /t 2 /nobreak >nul
curl -s http://localhost:3456/api/health 2>nul || echo [INFO] Server booting, test in a few seconds...

echo.
echo ========================================
echo   Auth server: http://localhost:3456
echo   Admin panel: http://localhost:3456/admin
echo   Admin key:   admin-change-me-in-production
echo ========================================
pause
