@echo off
echo Building LocalBooks DEBUG version (with console window)...
cd backend
python -m PyInstaller --name LocalBooks_Debug --onefile --console --add-data "company_data/ledgerlocal.db;company_data" --add-data "../frontend/dist;frontend/dist" app/main.py
cd ..
echo.
echo Debug build done! Run backend\dist\LocalBooks_Debug.exe in a terminal to see errors.
echo Leave the window open after running it.
pause
