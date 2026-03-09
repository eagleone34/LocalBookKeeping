@echo off
title LedgerLocal - Secure Bookkeeping
echo.
echo ============================================
echo   LedgerLocal - Secure Local Bookkeeping
echo ============================================
echo.
echo Starting your bookkeeping application...
echo Your data is stored locally and never leaves your machine.
echo.

cd /d "%~dp0backend"

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH.
    echo Please install Python from https://python.org
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist ".deps_installed" (
    echo Installing dependencies (first run only)...
    pip install -r requirements.txt
    echo. > .deps_installed
)

:: Build frontend if needed
if not exist "..\frontend\dist\index.html" (
    echo Building frontend (first run only)...
    cd /d "%~dp0frontend"
    npm install
    npm run build
    cd /d "%~dp0backend"
)

echo.
echo Opening LedgerLocal in your browser...
echo Close this window to stop the application.
echo.

:: Open browser and start server
start http://localhost:8000
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
