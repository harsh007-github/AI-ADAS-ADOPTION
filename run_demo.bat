@echo off
title Nivāra ADAS Demo
cd /d "%~dp0"
echo Starting Nivāra ADAS Middleware...
echo.
start "Nivāra Backend" cmd /c "cd backend && uvicorn app:app --port 8000"
timeout /t 2 /nobreak >nul
start "Nivāra Frontend" cmd /c "cd frontend && npm run dev"
echo.
echo Both services launching.
echo Backend: http://localhost:8000
echo Frontend: http://localhost:5173
echo Close the terminal windows to stop.
