@echo off
echo.
echo ==========================================
echo  LocalBooks Updater
echo  Your data will be protected throughout.
echo ==========================================
echo.

echo [1/2] Building latest LocalBooks...
echo.
call build.bat

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ==========================================
    echo  BUILD FAILED. Your data has NOT been touched.
    echo  Fix the build errors above and try again.
    echo ==========================================
    exit /b 1
)

echo.
echo [2/2] Running installer (your company_data is safe)...
echo.

rem  start /wait ensures we block until the installer process exits,
rem  so %ERRORLEVEL% reflects the installer's own exit code.
start /wait "" "backend\dist\LocalBooks_Setup.exe"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ==========================================
    echo  INSTALLER FAILED. Check the log at:
    echo  %USERPROFILE%\Documents\localbooks_setup.log
    echo ==========================================
    exit /b 1
)

echo.
echo ==========================================
echo  Update complete! Your data is safe.
echo ==========================================
