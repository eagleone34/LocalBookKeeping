@echo off
setlocal DisableDelayedExpansion
echo =========================================
echo Building LocalBooks...
echo =========================================

echo.
echo [1/4] Generating Demo Data (Chase/RBC)...
cd backend
python scripts/build_golden_copy.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: build_golden_copy.py failed!
    cd ..
    pause
    exit /b 1
)
cd ..

echo.
echo [2/4] Building React Frontend...
cd frontend
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: npm install failed!
    cd ..
    pause
    exit /b 1
)
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: npm run build failed!
    cd ..
    pause
    exit /b 1
)
cd ..

echo.
echo [3/4] Building main LocalBooks app (onedir)...
cd backend
python -m PyInstaller -y LocalBooks.spec > _build.log 2>&1
if not exist "dist\LocalBooks\LocalBooks.exe" (
    echo.
    echo ERROR: PyInstaller main app failed - output exe not found.
    echo Check backend\_build.log for details.
    cd ..
    pause
    exit /b 1
)
echo PyInstaller build succeeded.

echo.
echo [3b] Zipping LocalBooks folder for bundling into installer...
python -c "import shutil; shutil.make_archive('installer/LocalBooks', 'zip', 'dist', 'LocalBooks')"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Zip step failed!
    cd ..
    pause
    exit /b 1
)

echo.
echo [4/4] Building single-file Setup installer (bootstrapper)...
python -m PyInstaller -y LocalBooks_Setup.spec > _build_setup.log 2>&1
if not exist "dist\LocalBooks_Setup.exe" (
    echo.
    echo ERROR: PyInstaller installer failed - setup exe not found.
    echo Check backend\_build_setup.log for details.
    cd ..
    pause
    exit /b 1
)
echo Installer build succeeded.
cd ..

echo.
echo =========================================
echo DONE - Share backend\dist\LocalBooks_Setup.exe
echo That is the single file users download and run.
echo =========================================
echo Build completed successfully - continuing...
exit /b 0
