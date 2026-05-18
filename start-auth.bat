@echo off
chcp 65001 >nul
echo ========================================
echo   SLG 授权服务 - Docker 启动脚本
echo ========================================
echo.

REM Check Docker
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] Docker 未运行，请先启动 Docker Desktop
    pause
    exit /b 1
)
echo [OK] Docker 正在运行

REM Stop & remove old container
docker rm -f slg-auth >nul 2>&1
if %errorlevel% equ 0 echo [OK] 旧容器已删除

REM Build image
echo.
echo [构建] 正在构建镜像...
docker build -t slg-auth-server "%~dp0server-auth"
if %errorlevel% neq 0 (
    echo [错误] 镜像构建失败
    pause
    exit /b 1
)
echo [OK] 镜像构建完成

REM Ensure auth-data directory exists
if not exist "%~dp0server-auth\auth-data" mkdir "%~dp0server-auth\auth-data"

REM Run container with proper volume mount (directory, not single file)
echo.
echo [启动] 正在启动容器...
docker run -d ^
  --name slg-auth ^
  --restart unless-stopped ^
  -p 3456:3456 ^
  -v "%~dp0server-auth\auth-data:/app/data" ^
  -e DB_PATH=/app/data/auth.db ^
  -e ADMIN_KEY=admin-change-me-in-production ^
  -e JWT_SECRET=jwt-secret-change-me-in-production-2025 ^
  slg-auth-server

if %errorlevel% neq 0 (
    echo [错误] 容器启动失败
    pause
    exit /b 1
)

REM Verify
timeout /t 3 /nobreak >nul
echo.
echo [状态] 容器信息：
docker ps --filter name=slg-auth --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

REM Test endpoint
echo.
echo [测试] 健康检查...
curl -s http://localhost:3456/api/health 2>nul || echo [提示] 服务启动中，请稍候几秒后再试

echo.
echo ========================================
echo   ✅ 授权服务启动成功！
echo ========================================
echo   服务地址: http://localhost:3456
echo   管理面板: http://localhost:3456/admin
echo   管理密钥: admin-change-me-in-production
echo   数据目录: server-auth\auth-data\
echo   自动重启: 已启用 (unless-stopped)
echo ========================================
pause
