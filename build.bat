@echo off
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
python -m PyInstaller -y --name LocalBooks --onedir --noconsole --add-data "company_data/ledgerlocal.db;company_data" --add-data "../frontend/dist;frontend/dist" app/main.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: PyInstaller (main app) failed!
    cd ..
    pause
    exit /b 1
)

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
python -m PyInstaller -y --name LocalBooks_Setup --onefile --noconsole --add-data "installer/LocalBooks.zip;." installer/bootstrapper.py
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: PyInstaller (installer) failed!
    cd ..
    pause
    exit /b 1
)
cd ..

echo.
echo =========================================
echo DONE! Share backend\dist\LocalBooks_Setup.exe
echo That is the single file users download and run.
echo =========================================
echo Build completed successfully - continuing...
