@echo off
setlocal DisableDelayedExpansion

REM --- Safety: must be run from the DEV repo, not the installed app folder ---
if not exist ".git" (
    echo.
    echo  ERROR: update.bat must be run from the LocalBookKeeping git repo.
    echo  It looks like you're running it from: %CD%
    echo  Navigate to your DEV folder and try again.
    echo.
    pause
    exit /b 1
)

echo.
echo ==========================================
echo  LocalBooks Updater  (run from DEV repo)
echo  Your data in Documents\LocalBooks is safe.
echo ==========================================
echo.

echo [0/3] Freeing port 8000 (killing any dev server or stale app)...
powershell -Command "$conn = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue; if ($conn) { $procId = $conn.OwningProcess; $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue; Write-Host ('  Killing PID ' + $procId + ' (' + $proc.Name + ')...'); Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } else { Write-Host '  Port 8000 is free - nothing to kill.' }"
ping -n 3 127.0.0.1 >nul
echo.

echo [1/3] Pulling latest code from git...
echo.
git pull --ff-only
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ==========================================
    echo  GIT PULL FAILED.
    echo.
    echo  This usually means you have local changes
    echo  that conflict with the update. Try:
    echo.
    echo    git stash
    echo    git pull --ff-only
    echo    git stash pop
    echo.
    echo  Or check your internet connection.
    echo ==========================================
    pause
    exit /b 1
)

echo.
echo [2/3] Building everything (frontend + backend + installer)...
echo.
call build.bat
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ==========================================
    echo  BUILD FAILED. Your data has NOT been touched.
    echo  Fix the build errors above and try again.
    echo ==========================================
    pause
    exit /b 1
)

echo.
echo [3/3] Running installer (your company_data is safe)...
echo.
start /wait "" "backend\dist\LocalBooks_Setup.exe"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ==========================================
    echo  INSTALLER FAILED. Check the log at:
    echo  %USERPROFILE%\Documents\LocalBooks\localbooks_setup.log
    echo ==========================================
    pause
    exit /b 1
)

echo.
echo ==========================================
echo  Update complete - your data is safe.
echo ==========================================
pause
