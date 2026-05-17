@echo off
echo ========================================
echo   SLG Automation Framework - Start All
echo ========================================
echo.

echo Starting Backend Server (port 3000)...
start "SLG Backend" cmd /k "npm run server"

echo Waiting 3 seconds for backend to start...
timeout /t 3 /nobreak > nul

echo Starting Frontend Server (port 5173)...
start "SLG Frontend" cmd /k "cd web && npm run dev"

echo.
echo ========================================
echo   Services starting...
echo   Backend: http://localhost:3000
echo   Frontend: http://localhost:5173
echo.
echo   Two windows will open separately.
echo   Press any key to close this window...
echo ========================================
pause > nul
