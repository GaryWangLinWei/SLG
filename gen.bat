@echo off
setlocal
set DAYS=30
set COUNT=1

set /p DAYS="Days (default 30): "
if "%DAYS%"=="" set DAYS=30
set /p COUNT="Count (default 1): "
if "%COUNT%"=="" set COUNT=1

echo.
echo Generating...
curl -s -X POST http://localhost:3456/api/admin/codes/generate -H "Content-Type: application/json" -H "X-Admin-Key: admin-change-me-in-production" -d "{""count"": %COUNT%, ""durationDays"": %DAYS%}"
echo.
pause
