@echo off
setlocal DisableDelayedExpansion
echo.
echo ==========================================
echo  LocalBooks Updater
echo  Your data will be protected throughout.
echo ==========================================
echo.

echo [1/3] Pulling latest code from git...
echo.
git pull
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ==========================================
    echo  GIT PULL FAILED. Check your internet
    echo  connection or repository access.
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
    echo  %USERPROFILE%\Documents\localbooks_setup.log
    echo ==========================================
    pause
    exit /b 1
)

echo.
echo ==========================================
echo  Update complete - your data is safe.
echo ==========================================
pause
