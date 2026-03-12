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

    target_exe = INSTALL_DIR / APP_EXE_NAME
    if not target_exe.exists():
        msgbox("Setup Error", f"Expected executable not found after extraction:\n{target_exe}", 0x10)
        sys.exit(1)

    # ── Desktop shortcut ──
    try:
        shortcut = Path.home() / "Desktop" / "LocalBooks.lnk"
        ps = (
            f'$ws = New-Object -ComObject WScript.Shell;'
            f'$sc = $ws.CreateShortcut("{shortcut}");'
            f'$sc.TargetPath = "{target_exe}";'
            f'$sc.WorkingDirectory = "{INSTALL_DIR}";'
            f'$sc.IconLocation = "{target_exe}";'
            f'$sc.Save()'
        )
        subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
            creationflags=0x08000000,
            timeout=10
        )
        log("Desktop shortcut created.")
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
