r"""
LocalBooks Setup Bootstrapper
Tiny installer - no FastAPI/uvicorn, stdlib only.
Shows EULA, extracts app to Documents\LocalBooks, creates shortcut, launches app.

Update strategy (data-protection invariant):
  - FIRST INSTALL  : full extraction, everything including company_data/
  - SUBSEQUENT RUN : extract to a temp dir, then selectively copy every file EXCEPT
                     company_data/ — that directory is NEVER read, written, moved,
                     renamed, or deleted under any circumstances.
"""
from __future__ import annotations

import sys
import zipfile
import shutil
import subprocess
import time
from pathlib import Path

INSTALL_DIR  = Path.home() / "Documents" / "LocalBooks"
APP_EXE_NAME = "LocalBooks.exe"
LOG_FILE     = Path.home() / "Documents" / "localbooks_setup.log"

# Temp directory used during selective-update extraction.
# Sits alongside INSTALL_DIR (same volume) to make the rename atomic-ish.
UPDATE_TMP_DIR: Path = INSTALL_DIR.parent / "LocalBooks_update_tmp"

# The one directory that is NEVER touched by the installer — under any circumstance.
PROTECTED_DIR_NAME = "company_data"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_desktop_path() -> Path:
    """Return the real Windows Desktop path (handles OneDrive-synced desktops).
    Falls back to ~/Desktop on any error.
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
    return Path.home() / "Desktop"


def log(msg: str) -> None:
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} - {msg}\n")
    except Exception:
        pass


def msgbox(title: str, msg: str, style: int = 0) -> int:
    try:
        import ctypes
        return ctypes.windll.user32.MessageBoxW(0, msg, title, style)
    except Exception as e:
        log(f"msgbox error: {e}")
        return 0


# ---------------------------------------------------------------------------
# Core data-protection logic
# ---------------------------------------------------------------------------

def _selective_update(extracted_root: Path) -> None:
    """Copy every file from *extracted_root* into INSTALL_DIR, skipping company_data/.

    This is the complete data-protection implementation.  The existing
    company_data/ directory in INSTALL_DIR is never read, written to, moved,
    renamed, or deleted — not a single byte is touched.

    Args:
        extracted_root: Root of the newly extracted archive
                        (e.g. UPDATE_TMP_DIR / "LocalBooks").
    """
    skipped = 0
    updated = 0

    for src_path in extracted_root.rglob("*"):
        rel = src_path.relative_to(extracted_root)
        parts = rel.parts

        # Absolute guard: the moment any relative path starts with PROTECTED_DIR_NAME,
        # skip it completely — no partial copies, no directory creation, nothing.
        if parts and parts[0] == PROTECTED_DIR_NAME:
            skipped += 1
            log(f"[PROTECTED] Skipped (sacred data dir): {rel}")
            continue

        dest_path = INSTALL_DIR / rel

        if src_path.is_dir():
            dest_path.mkdir(parents=True, exist_ok=True)
        else:
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src_path, dest_path)
            updated += 1

    log(
        f"Selective update complete: {updated} file(s) updated, "
        f"{skipped} item(s) skipped (company_data/ was NOT touched)."
    )


# ---------------------------------------------------------------------------
# Main installer logic
# ---------------------------------------------------------------------------

def main() -> None:
    log("=== LocalBooks Setup starting ===")

    # Determine early so we can conditionally show the EULA.
    is_first_install = not INSTALL_DIR.exists()

    if is_first_install:
        # ── EULA (first install only) ──────────────────────────────────────
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
    else:
        # ── Update notice (no EULA re-prompt) ─────────────────────────────
        msgbox(
            "LocalBooks Update",
            f"Updating LocalBooks to the latest version.\n\n"
            f"Your company data will not be affected.\n\n"
            f"Installing to: {INSTALL_DIR}",
            0x40 | 262144,  # MB_ICONINFORMATION | MB_TOPMOST
        )
        log("Update run detected — skipping EULA (already accepted on first install).")

    # ── Kill running instances ──
    try:
        subprocess.run(["taskkill", "/IM", APP_EXE_NAME, "/F"], capture_output=True)
        log("Attempted to kill running LocalBooks.exe instances.")
        time.sleep(1)  # allow the process to fully release file handles
    except Exception as e:
        log(f"taskkill error: {e}")

    # ── Locate the bundled archive ──
    if getattr(sys, "_MEIPASS", None):
        zip_path = Path(sys._MEIPASS) / "LocalBooks.zip"
    else:
        # Dev / test mode: look relative to this script
        zip_path = Path(__file__).parent / "LocalBooks.zip"

    log(f"zip_path={zip_path}")

    if not zip_path.exists():
        msgbox("Setup Error", f"Installation archive not found:\n{zip_path}", 0x10)
        sys.exit(1)

    # ── Branch: first install vs. update ──
    if is_first_install:
        # ── FIRST INSTALL ──────────────────────────────────────────────────
        # No existing data to protect; extract everything including company_data/
        # (which contains the bundled demo database used for the initial setup).
        log("First install detected — extracting full archive to install directory.")
        try:
            INSTALL_DIR.parent.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(zip_path, "r") as zf:
                # Archive root is "LocalBooks/"; extractall to parent produces
                # Documents/LocalBooks/... correctly.
                zf.extractall(INSTALL_DIR.parent)
            log(f"First install extraction complete: {INSTALL_DIR}")
        except Exception as e:
            msgbox("Setup Error", f"Extraction failed:\n{e}", 0x10)
            sys.exit(1)

    else:
        # ── UPDATE ─────────────────────────────────────────────────────────
        # Extract to a temp dir, then selectively copy into INSTALL_DIR,
        # SKIPPING company_data/ entirely.  User's data is never touched.
        log(
            f"Existing installation found at {INSTALL_DIR}. "
            "Performing selective update — company_data/ will NOT be touched."
        )

        # Remove any leftover temp dir from a previous interrupted run.
        if UPDATE_TMP_DIR.exists():
            try:
                shutil.rmtree(UPDATE_TMP_DIR)
                log(f"Removed leftover temp directory: {UPDATE_TMP_DIR}")
            except Exception as e:
                log(f"WARNING: Could not remove leftover temp dir: {e}")

        try:
            UPDATE_TMP_DIR.mkdir(parents=True, exist_ok=True)

            with zipfile.ZipFile(zip_path, "r") as zf:
                # Archive root is "LocalBooks/" — extracting into UPDATE_TMP_DIR
                # produces UPDATE_TMP_DIR/LocalBooks/<files>.
                zf.extractall(UPDATE_TMP_DIR)

            extracted_root = UPDATE_TMP_DIR / "LocalBooks"
            if not extracted_root.exists():
                raise RuntimeError(
                    f"Expected archive root 'LocalBooks/' not found inside "
                    f"{UPDATE_TMP_DIR}. Archive structure may have changed."
                )
            log(f"Archive extracted to temp: {extracted_root}")

            # Copy everything except company_data/ into the live install dir.
            _selective_update(extracted_root)

        except Exception as e:
            msgbox(
                "Setup Error",
                f"Update failed:\n{e}\n\n"
                "Your data in company_data/ has NOT been modified.",
                0x10,
            )
            sys.exit(1)

        finally:
            # Always clean up the temp directory — even if sys.exit() was called above
            # (SystemExit is still an exception; finally blocks always execute).
            if UPDATE_TMP_DIR.exists():
                try:
                    shutil.rmtree(UPDATE_TMP_DIR)
                    log(f"Temp directory cleaned up: {UPDATE_TMP_DIR}")
                except Exception as e:
                    log(f"WARNING: Could not remove temp directory {UPDATE_TMP_DIR}: {e}")

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
    # Use VBScript via cscript.exe — more reliable than PowerShell in windowless
    # installer contexts (no execution-policy issues, available on all Windows versions).
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
        vbs_path.unlink(missing_ok=True)  # clean up temp VBS file
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
