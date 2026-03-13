"""
LocalBooks Setup Bootstrapper
Tiny installer - no FastAPI/uvicorn, stdlib only.
Shows EULA, extracts app to Documents\LocalBooks, creates shortcut, launches app.
"""
import sys
import os
import zipfile
import shutil
import subprocess
import time
from pathlib import Path

INSTALL_DIR  = Path.home() / "Documents" / "LocalBooks"
APP_EXE_NAME = "LocalBooks.exe"
LOG_FILE     = Path.home() / "Documents" / "localbooks_setup.log"


def get_desktop_path() -> Path:
    """Get the actual Windows Desktop path via the Shell API.
    Handles OneDrive-synced desktops, custom locations, etc.
    Falls back to ~/Desktop if the API call fails.
    """
    try:
        import ctypes
        buf = ctypes.create_unicode_buffer(300)
        # SHGetFolderPathW(hwnd, CSIDL_DESKTOP=0, token, flags, path)
        ctypes.windll.shell32.SHGetFolderPathW(0, 0, 0, 0, buf)
        p = Path(buf.value)
        if p.exists():
            return p
    except Exception:
        pass
    return Path.home() / "Desktop"  # fallback


def log(msg):
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} - {msg}\n")
    except Exception:
        pass


def msgbox(title, msg, style=0):
    try:
        import ctypes
        return ctypes.windll.user32.MessageBoxW(0, msg, title, style)
    except Exception as e:
        log(f"msgbox error: {e}")
        return 0


def main():
    log("=== LocalBooks Setup starting ===")

    # ── EULA ──
    eula = (
        "LocalBooks Beta - User Agreement\n\n"
        "This software is for educational purposes only.\n"
        "The creator is not liable for any data loss or financial errors.\n"
        "This software is currently in Beta.\n\n"
        "Accept and install LocalBooks to:\n"
        f"{INSTALL_DIR}\n\n"
        "A Desktop shortcut will be created."
    )
    result = msgbox("LocalBooks Setup", eula, 4 | 64 | 262144)  # MB_YESNO|INFO|TOPMOST
    if result != 6:  # IDYES
        log("User declined EULA.")
        sys.exit(0)
    log("EULA accepted.")

    # ── Kill running instances ──
    try:
        subprocess.run(["taskkill", "/IM", APP_EXE_NAME, "/F"], capture_output=True)
        log("Attempted to kill running LocalBooks.exe instances.")
        time.sleep(1) # wait for process to die
    except Exception as e:
        log(f"taskkill error: {e}")

    # ── Backup Database ──
    db_backup_path = None
    existing_db = INSTALL_DIR / "company_data" / "localbooks.db"
    
    if existing_db.exists():
        db_backup_path = Path.home() / "Documents" / "localbooks_backup.db"
        try:
            shutil.copy2(existing_db, db_backup_path)
            log(f"Backed up existing database to {db_backup_path}")
        except Exception as e:
            log(f"Warning: Failed to backup database: {e}")

    # ── Remove any existing installation ──
    if INSTALL_DIR.exists():
        try:
            shutil.rmtree(INSTALL_DIR)
            log("Removed existing install dir.")
        except Exception as e:
            msgbox("Setup Error", f"Could not remove old installation:\n{e}\n\nClose LocalBooks if it's running.", 0x10)
            sys.exit(1)

    # ── Extract bundled LocalBooks.zip ──
    if getattr(sys, '_MEIPASS', None):
        zip_path = Path(sys._MEIPASS) / "LocalBooks.zip"
    else:
        # Dev mode: look relative to this script
        zip_path = Path(__file__).parent / "LocalBooks.zip"

    log(f"zip_path={zip_path}")

    if not zip_path.exists():
        msgbox("Setup Error", f"Installation archive not found:\n{zip_path}", 0x10)
        sys.exit(1)

    try:
        log("Extracting archive...")
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(INSTALL_DIR.parent)   # extracts LocalBooks/ into Documents/
        log(f"Extracted to {INSTALL_DIR}")
    except Exception as e:
        msgbox("Setup Error", f"Extraction failed:\n{e}", 0x10)
        sys.exit(1)

    # ── Restore Database ──
    if db_backup_path and db_backup_path.exists():
        new_db_path = INSTALL_DIR / "company_data" / "localbooks.db"
        try:
            new_db_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(db_backup_path, new_db_path)
            log(f"Restored existing database to {new_db_path}")
            db_backup_path.unlink() # Cleanup backup
        except Exception as e:
            log(f"Warning: Failed to restore database: {e}")
            msgbox("Setup Warning", f"Failed to restore your old database.\nIt was backed up to: {db_backup_path}", 0x30)

    target_exe = INSTALL_DIR / APP_EXE_NAME
    if not target_exe.exists():
        msgbox("Setup Error", f"Expected executable not found after extraction:\n{target_exe}", 0x10)
        sys.exit(1)

    # ── Desktop shortcut ──
    # Use VBScript via cscript.exe - more reliable than PowerShell in windowless
    # installer contexts (no execution policy issues, available on all Windows versions).
    try:
        shortcut_path = get_desktop_path() / "LocalBooks.lnk"
        vbs_path = Path.home() / "AppData" / "Local" / "Temp" / "create_lb_shortcut.vbs"
        vbs_content = (
            f'Set ws = CreateObject("WScript.Shell")\r\n'
            f'Set sc = ws.CreateShortcut("{shortcut_path}")\r\n'
            f'sc.TargetPath = "{target_exe}"\r\n'
            f'sc.WorkingDirectory = "{INSTALL_DIR}"\r\n'
            f'sc.IconLocation = "{target_exe}, 0"\r\n'
            f'sc.Description = "LocalBooks - Local Bookkeeping"\r\n'
            f'sc.Save()\r\n'
        )
        vbs_path.write_text(vbs_content, encoding="utf-8")
        cscript = r"C:\Windows\System32\cscript.exe"
        result = subprocess.run(
            [cscript, "//Nologo", str(vbs_path)],
            capture_output=True, text=True, timeout=15
        )
        vbs_path.unlink(missing_ok=True)  # clean up temp file
        if result.returncode != 0:
            log(f"Shortcut VBS stderr: {result.stderr.strip()}")
            log("Shortcut creation may have failed (non-fatal).")
        else:
            log(f"Desktop shortcut created: {shortcut_path}")
    except Exception as e:
        log(f"Shortcut error (non-fatal): {e}")

    # ── Launch the installed app ──
    try:
        subprocess.Popen([str(target_exe)], creationflags=0x08000000)
        log("App launched.")
    except Exception as e:
        msgbox("Setup Error", f"Installed but could not launch LocalBooks:\n{e}", 0x10)
        sys.exit(1)

    msgbox(
        "LocalBooks Installed!",
        "LocalBooks has been installed to:\n"
        f"{INSTALL_DIR}\n\n"
        "A Desktop shortcut has been created.\n"
        "The app is opening in your browser now!",
        0x40  # MB_ICONINFORMATION
    )
    log("Setup complete.")
    sys.exit(0)


if __name__ == "__main__":
    main()
