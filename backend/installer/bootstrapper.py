r"""
LocalBooks Setup Bootstrapper
Tiny installer - no FastAPI/uvicorn, stdlib only.
Shows EULA, extracts app to Documents\LocalBooks, creates shortcut, launches app.
"""
from __future__ import annotations

import sys
import os
import json
import zipfile
import shutil
import subprocess
import time
from datetime import datetime
from pathlib import Path

INSTALL_DIR  = Path.home() / "Documents" / "LocalBooks"
APP_EXE_NAME = "LocalBooks.exe"
LOG_FILE     = Path.home() / "Documents" / "localbooks_setup.log"

# Backup destination: %APPDATA%\LocalBooks\backups\  (isolated from install dir)
_APPDATA = os.environ.get("APPDATA", "")
APPDATA_BASE: Path = (
    Path(_APPDATA) / "LocalBooks"
    if _APPDATA
    else Path.home() / "AppData" / "Roaming" / "LocalBooks"
)
APPDATA_BACKUPS_DIR: Path = APPDATA_BASE / "backups"
RESTORE_SENTINEL: Path = APPDATA_BASE / "restore_pending.json"
MAX_BACKUPS = 10


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


# ---------------------------------------------------------------------------
# Backup helpers (stdlib only — mirrors backup_service.py logic)
# ---------------------------------------------------------------------------

def _backup_all_dbs(data_dir: Path) -> Path | None:
    """Copy every *.db file from *data_dir* to a timestamped APPDATA folder.

    Returns the backup folder Path on success, None on failure.
    """
    db_files = list(data_dir.glob("*.db"))
    if not db_files:
        log(f"No *.db files found in {data_dir} — nothing to back up.")
        return None

    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    backup_folder = APPDATA_BACKUPS_DIR / timestamp

    try:
        backup_folder.mkdir(parents=True, exist_ok=True)

        backed_up = []
        for db_file in db_files:
            dest = backup_folder / db_file.name
            shutil.copy2(db_file, dest)
            src_size = db_file.stat().st_size
            dst_size = dest.stat().st_size
            if src_size != dst_size:
                raise RuntimeError(
                    f"Size mismatch: {db_file.name} src={src_size} dst={dst_size}"
                )
            log(f"BACKUP: {db_file.name} ({src_size:,} bytes) → {dest}")
            backed_up.append(db_file.name)

        meta = {
            "timestamp": timestamp,
            "source_dir": str(data_dir),
            "files": backed_up,
            "created_at": datetime.now().isoformat(),
        }
        (backup_folder / "meta.json").write_text(
            json.dumps(meta, indent=2), encoding="utf-8"
        )
        log(f"Backup complete → {backup_folder}")
        _prune_old_backups()
        return backup_folder

    except Exception as exc:
        log(f"ERROR: Backup failed: {exc}")
        try:
            if backup_folder.exists():
                shutil.rmtree(backup_folder)
        except Exception:
            pass
        return None


def _write_restore_sentinel(backup_folder: Path) -> None:
    """Write restore_pending.json so main.py can finish the restore if the
    bootstrapper crashes between extraction and the inline restore step."""
    try:
        APPDATA_BASE.mkdir(parents=True, exist_ok=True)
        sentinel = {
            "backup_folder": str(backup_folder),
            "written_at": datetime.now().isoformat(),
        }
        RESTORE_SENTINEL.write_text(
            json.dumps(sentinel, indent=2), encoding="utf-8"
        )
        log(f"Restore sentinel written: {RESTORE_SENTINEL}")
    except Exception as exc:
        log(f"WARNING: Could not write restore sentinel: {exc}")


def _clear_restore_sentinel() -> None:
    """Remove sentinel after a successful inline restore."""
    try:
        if RESTORE_SENTINEL.exists():
            RESTORE_SENTINEL.unlink()
            log("Restore sentinel cleared.")
    except Exception as exc:
        log(f"WARNING: Could not clear restore sentinel: {exc}")


def _restore_from_backup(backup_folder: Path, data_dir: Path) -> bool:
    """Restore all *.db files from backup_folder into data_dir."""
    db_files = list(backup_folder.glob("*.db"))
    if not db_files:
        log(f"No *.db files in backup folder {backup_folder}.")
        return False
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
        for db_file in db_files:
            dest = data_dir / db_file.name
            shutil.copy2(db_file, dest)
            restored_size = dest.stat().st_size
            if restored_size != db_file.stat().st_size:
                raise RuntimeError(
                    f"Restore size mismatch: {db_file.name} "
                    f"expected={db_file.stat().st_size} got={restored_size}"
                )
            log(f"RESTORED: {db_file.name} ({restored_size:,} bytes) → {dest}")
        return True
    except Exception as exc:
        log(f"ERROR: Inline restore failed: {exc}")
        return False


def _prune_old_backups() -> None:
    """Keep only the MAX_BACKUPS most recent backup folders."""
    if not APPDATA_BACKUPS_DIR.exists():
        return
    folders = sorted(
        [d for d in APPDATA_BACKUPS_DIR.iterdir() if d.is_dir()],
        key=lambda d: d.name,
        reverse=True,
    )
    for old in folders[MAX_BACKUPS:]:
        try:
            shutil.rmtree(old)
            log(f"Pruned old backup: {old}")
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Main installer logic
# ---------------------------------------------------------------------------

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
        time.sleep(1)  # wait for process to die
    except Exception as e:
        log(f"taskkill error: {e}")

    # ── Back up ALL *.db files from company_data/ to APPDATA ──
    company_data_dir = INSTALL_DIR / "company_data"
    backup_folder: Path | None = None

    log(f"Checking for existing databases in: {company_data_dir}")
    if company_data_dir.exists() and any(company_data_dir.glob("*.db")):
        backup_folder = _backup_all_dbs(company_data_dir)
        if backup_folder:
            # Write sentinel BEFORE we wipe the install dir.
            # If we crash between extraction and the inline restore below,
            # main.py will detect the sentinel on next startup and restore.
            _write_restore_sentinel(backup_folder)
        else:
            log("WARNING: Backup failed — continuing anyway. Existing data may be at risk.")
            msgbox(
                "Setup Warning",
                "Could not create a backup of your existing databases.\n\n"
                f"Your data is stored in:\n{company_data_dir}\n\n"
                "Setup will continue, but consider cancelling and backing up manually.",
                0x30,  # MB_ICONWARNING
            )
    else:
        log("No existing databases found — fresh install.")

    # ── Remove any existing installation ──
    if INSTALL_DIR.exists():
        try:
            shutil.rmtree(INSTALL_DIR)
            log("Removed existing install dir.")
        except Exception as e:
            msgbox(
                "Setup Error",
                f"Could not remove old installation:\n{e}\n\nClose LocalBooks if it's running.",
                0x10,
            )
            sys.exit(1)

    # ── Extract bundled LocalBooks.zip ──
    if getattr(sys, "_MEIPASS", None):
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

    # ── Inline restore: immediately overwrite the bundled demo DB ──
    # Priority: user's own data always takes precedence over the bundled golden copy.
    new_company_data_dir = INSTALL_DIR / "company_data"
    if backup_folder and backup_folder.exists():
        log("Backup exists — restoring user databases over the extracted bundle.")
        restore_ok = _restore_from_backup(backup_folder, new_company_data_dir)
        if restore_ok:
            # Sentinel is no longer needed; clear it so main.py skips redundant restore.
            _clear_restore_sentinel()
            log("Inline restore succeeded — sentinel cleared.")
        else:
            log(
                "WARNING: Inline restore failed. "
                "Sentinel left in place so main.py will attempt recovery on next startup."
            )
            msgbox(
                "Setup Warning",
                f"Could not restore your databases during setup.\n\n"
                f"LocalBooks will attempt to recover automatically on first run.\n\n"
                f"Your backup is safely stored at:\n{backup_folder}",
                0x30,
            )
    else:
        # Fresh install — use the bundled database
        if new_company_data_dir.exists() and any(new_company_data_dir.glob("*.db")):
            log(f"Fresh install — using bundled database in {new_company_data_dir}")
        else:
            log("No database present after extract — will be created on first run.")

    # ── Verify executable ──
    target_exe = INSTALL_DIR / APP_EXE_NAME
    if not target_exe.exists():
        msgbox(
            "Setup Error",
            f"Expected executable not found after extraction:\n{target_exe}",
            0x10,
        )
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
            capture_output=True, text=True, timeout=15,
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
        0x40,  # MB_ICONINFORMATION
    )
    log("Setup complete.")
    sys.exit(0)


if __name__ == "__main__":
    main()
