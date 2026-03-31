@echo off
setlocal DisableDelayedExpansion
echo =========================================
echo Building LocalBooks...
echo =========================================

:: ── Step 1: Demo Data ──────────────────────────────────────────────────────
:: Only regenerate if the golden-copy DB doesn't exist yet.
echo.
if exist "backend\company_data\ledgerlocal.db" (
    echo [1/4] Demo data already exists — skipping.
) else (
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
)

:: ── Step 2: Frontend ───────────────────────────────────────────────────────
echo.
cd frontend

:: Skip npm install if node_modules is up-to-date with package-lock.json.
:: We compare the timestamps: if node_modules\.package-lock.json is newer
:: than package-lock.json, dependencies haven't changed since last install.
set "NEED_INSTALL=1"
if exist "node_modules\.package-lock.json" (
    for %%A in ("package-lock.json") do set "LOCK_DATE=%%~tA"
    for %%B in ("node_modules\.package-lock.json") do set "MOD_DATE=%%~tB"
    :: xcopy /D /L compares timestamps — outputs a filename only if source is newer
    echo n | xcopy /D /L "package-lock.json" "node_modules\.package-lock.json" >nul 2>&1
    if %ERRORLEVEL% EQU 1 (
        echo [2/4] node_modules up to date — skipping npm install.
        set "NEED_INSTALL=0"
    )
)
if "%NEED_INSTALL%"=="1" (
    echo [2/4] Installing frontend dependencies...
    call npm ci --prefer-offline
    if %ERRORLEVEL% NEQ 0 (
        echo.
        echo ERROR: npm install failed!
        cd ..
        pause
        exit /b 1
    )
)

echo [2b/4] Building React Frontend...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: npm run build failed!
    cd ..
    pause
    exit /b 1
)
cd ..

:: ── Step 3: PyInstaller main app ───────────────────────────────────────────
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

:: ── Step 4: PyInstaller installer ──────────────────────────────────────────
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
