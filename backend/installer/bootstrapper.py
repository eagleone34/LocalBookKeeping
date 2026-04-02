r"""
LocalBooks Setup Bootstrapper
Tkinter-based installer wizard — stdlib only.
Shows EULA, lets user pick install location, extracts app, creates shortcut, launches app.

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
import threading
from pathlib import Path

# Defaults — overridden by the wizard when the user picks a custom path.
DEFAULT_INSTALL_DIR = Path.home() / "Documents" / "LocalBooks"
APP_EXE_NAME = "LocalBooks.exe"
LOG_FILE = Path.home() / "Documents" / "LocalBooks" / "localbooks_setup.log"

# The one directory that is NEVER touched by the installer — under any circumstance.
PROTECTED_DIR_NAME = "company_data"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_desktop_path() -> Path:
    """Return the real Windows Desktop path (handles OneDrive-synced desktops)."""
    try:
        import ctypes
        buf = ctypes.create_unicode_buffer(300)
        ctypes.windll.shell32.SHGetFolderPathW(0, 0, 0, 0, buf)
        p = Path(buf.value)
        if p.exists():
            return p
    except Exception:
        pass
    return Path.home() / "Desktop"


def log(msg: str) -> None:
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
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

def _selective_update(install_dir: Path, extracted_root: Path) -> None:
    """Copy every file from *extracted_root* into install_dir, skipping company_data/."""
    skipped = 0
    updated = 0

    for src_path in extracted_root.rglob("*"):
        rel = src_path.relative_to(extracted_root)
        parts = rel.parts

        if parts and parts[0] == PROTECTED_DIR_NAME:
            skipped += 1
            log(f"[PROTECTED] Skipped (sacred data dir): {rel}")
            continue

        dest_path = install_dir / rel

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
# Tkinter Installer Wizard
# ---------------------------------------------------------------------------

EULA_TEXT = (
    "LocalBooks Beta - User Agreement\n"
    "\n"
    "This software is for educational purposes only.\n"
    "\n"
    "The creator is not liable for any data loss or financial errors. "
    "By installing this software, you acknowledge that:\n"
    "\n"
    "  1. This software is currently in Beta.\n"
    "  2. Your data is stored locally on your computer.\n"
    "  3. No data is sent to any external server.\n"
    "  4. The creator provides no warranty of any kind.\n"
    "\n"
    "Use at your own risk. Back up your data regularly.\n"
)

# Window dimensions
WIN_WIDTH = 550
WIN_HEIGHT = 420


class InstallerWizard:
    """Four-screen Tkinter installer wizard."""

    def __init__(self) -> None:
        import tkinter as tk
        from tkinter import ttk

        self.tk = tk
        self.ttk = ttk

        self.root = tk.Tk()
        self.root.title("LocalBooks Setup")
        self.root.resizable(False, False)
        self.root.protocol("WM_DELETE_WINDOW", self._on_cancel)
        self._center_window()

        # Try to use the Windows native theme
        try:
            style = ttk.Style(self.root)
            style.theme_use("vista")
        except Exception:
            pass

        # State
        self.install_dir = DEFAULT_INSTALL_DIR
        self.is_first_install = not DEFAULT_INSTALL_DIR.exists()
        self.install_path_var = tk.StringVar(value=str(DEFAULT_INSTALL_DIR))
        self.accept_var = tk.BooleanVar(value=False)
        self.launch_var = tk.BooleanVar(value=True)

        # Main content frame (swapped per screen)
        self.content = tk.Frame(self.root)
        self.content.pack(fill="both", expand=True, padx=20, pady=(15, 5))

        # Bottom button bar
        self.btn_bar = tk.Frame(self.root)
        self.btn_bar.pack(fill="x", padx=20, pady=(5, 15))

        # Show first screen
        if self.is_first_install:
            self._show_eula()
        else:
            self._show_location()

    # ----- Window helpers -----

    def _center_window(self) -> None:
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        x = (sw - WIN_WIDTH) // 2
        y = (sh - WIN_HEIGHT) // 2
        self.root.geometry(f"{WIN_WIDTH}x{WIN_HEIGHT}+{x}+{y}")

    def _clear(self) -> None:
        for w in self.content.winfo_children():
            w.destroy()
        for w in self.btn_bar.winfo_children():
            w.destroy()

    # ----- Screen 1: EULA -----

    def _show_eula(self) -> None:
        tk = self.tk
        ttk = self.ttk
        self._clear()

        # Header
        tk.Label(
            self.content, text="Welcome to LocalBooks Setup",
            font=("Segoe UI", 14, "bold"), anchor="w",
        ).pack(fill="x", pady=(0, 10))

        tk.Label(
            self.content,
            text="Please read the following agreement before continuing:",
            font=("Segoe UI", 9), anchor="w",
        ).pack(fill="x")

        # EULA text
        from tkinter import scrolledtext
        txt = scrolledtext.ScrolledText(
            self.content, wrap="word", font=("Segoe UI", 9),
            height=12, state="normal", relief="solid", borderwidth=1,
        )
        txt.insert("1.0", EULA_TEXT)
        txt.configure(state="disabled")
        txt.pack(fill="both", expand=True, pady=(5, 10))

        # Accept checkbox
        chk = ttk.Checkbutton(
            self.content, text="I accept the terms of this agreement",
            variable=self.accept_var, command=self._toggle_next,
        )
        chk.pack(anchor="w")

        # Buttons
        ttk.Button(self.btn_bar, text="Cancel", command=self._on_cancel).pack(side="right", padx=(5, 0))
        self._next_btn = ttk.Button(
            self.btn_bar, text="Next >", command=self._show_location,
            state="disabled",
        )
        self._next_btn.pack(side="right")

    def _toggle_next(self) -> None:
        state = "normal" if self.accept_var.get() else "disabled"
        self._next_btn.configure(state=state)

    # ----- Screen 2: Install Location -----

    def _show_location(self) -> None:
        tk = self.tk
        ttk = self.ttk
        self._clear()

        is_update = not self.is_first_install

        title = "Update LocalBooks" if is_update else "Choose Install Location"
        tk.Label(
            self.content, text=title,
            font=("Segoe UI", 14, "bold"), anchor="w",
        ).pack(fill="x", pady=(0, 10))

        if is_update:
            tk.Label(
                self.content,
                text="Updating LocalBooks to the latest version.\nYour company data will not be affected.",
                font=("Segoe UI", 9), anchor="w", justify="left",
            ).pack(fill="x", pady=(0, 15))

        tk.Label(
            self.content,
            text="LocalBooks will be installed to:",
            font=("Segoe UI", 9), anchor="w",
        ).pack(fill="x", pady=(0, 5))

        # Path entry + Browse
        path_frame = tk.Frame(self.content)
        path_frame.pack(fill="x", pady=(0, 10))

        entry = ttk.Entry(
            path_frame, textvariable=self.install_path_var, font=("Segoe UI", 9),
        )
        entry.pack(side="left", fill="x", expand=True, padx=(0, 5))

        browse_btn = ttk.Button(
            path_frame, text="Browse...", command=self._browse_folder,
        )
        browse_btn.pack(side="right")

        if is_update:
            entry.configure(state="readonly")
            browse_btn.configure(state="disabled")


        # Spacer
        tk.Frame(self.content).pack(fill="both", expand=True)

        # Info text
        tk.Label(
            self.content,
            text="A desktop shortcut will be created automatically.",
            font=("Segoe UI", 8), fg="#666666", anchor="w",
        ).pack(fill="x", pady=(0, 5))

        # Buttons
        ttk.Button(self.btn_bar, text="Cancel", command=self._on_cancel).pack(side="right", padx=(5, 0))
        ttk.Button(
            self.btn_bar, text="Install", command=self._start_install,
        ).pack(side="right")

        if self.is_first_install:
            ttk.Button(
                self.btn_bar, text="< Back", command=self._show_eula,
            ).pack(side="right", padx=(0, 5))

    def _browse_folder(self) -> None:
        from tkinter import filedialog
        chosen = filedialog.askdirectory(
            initialdir=str(Path.home() / "Documents"),
            title="Choose LocalBooks Install Location",
        )
        if chosen:
            # Append "LocalBooks" if the user picks a parent like Documents
            chosen_path = Path(chosen)
            if chosen_path.name != "LocalBooks":
                chosen_path = chosen_path / "LocalBooks"
            self.install_path_var.set(str(chosen_path))

    # ----- Screen 3: Progress -----

    def _start_install(self) -> None:
        # Validate the chosen path
        chosen = self.install_path_var.get().strip()
        if not chosen:
            msgbox("Invalid Path", "Please enter an installation path.", 0x30)
            return

        try:
            self.install_dir = Path(chosen)
        except Exception:
            msgbox("Invalid Path", f"The path is not valid:\n{chosen}", 0x30)
            return

        self._show_progress()

    def _show_progress(self) -> None:
        tk = self.tk
        ttk = self.ttk
        self._clear()

        title = "Updating LocalBooks..." if not self.is_first_install else "Installing LocalBooks..."
        tk.Label(
            self.content, text=title,
            font=("Segoe UI", 14, "bold"), anchor="w",
        ).pack(fill="x", pady=(0, 15))

        # Status label
        self._status_var = tk.StringVar(value="Preparing...")
        tk.Label(
            self.content, textvariable=self._status_var,
            font=("Segoe UI", 9), anchor="w",
        ).pack(fill="x", pady=(0, 8))

        # Progress bar
        self._progress = ttk.Progressbar(
            self.content, orient="horizontal", length=400, mode="determinate",
            maximum=100,
        )
        self._progress.pack(fill="x", pady=(0, 15))

        # Spacer
        tk.Frame(self.content).pack(fill="both", expand=True)

        # No buttons during install (Cancel is disabled)
        ttk.Button(self.btn_bar, text="Cancel", state="disabled").pack(side="right")

        # Run installation in background thread
        t = threading.Thread(target=self._do_install, daemon=True)
        t.start()

    def _update_progress(self, value: int, message: str) -> None:
        self._progress["value"] = value
        self._status_var.set(message)

    def _do_install(self) -> None:
        """Background thread: runs the actual installation."""
        install_dir = self.install_dir
        update_tmp_dir = install_dir.parent / "LocalBooks_update_tmp"
        is_first = self.is_first_install

        try:
            # Step 1: Kill running instances
            self.root.after(0, self._update_progress, 5, "Stopping running instances...")
            try:
                subprocess.run(["taskkill", "/IM", APP_EXE_NAME, "/F"], capture_output=True)
                log("Attempted to kill running LocalBooks.exe instances.")
                time.sleep(1)
            except Exception as e:
                log(f"taskkill error: {e}")

            # Step 2: Locate bundled archive
            self.root.after(0, self._update_progress, 10, "Locating installation archive...")
            if getattr(sys, "_MEIPASS", None):
                zip_path = Path(sys._MEIPASS) / "LocalBooks.zip"
            else:
                zip_path = Path(__file__).parent / "LocalBooks.zip"

            log(f"zip_path={zip_path}")
            if not zip_path.exists():
                self.root.after(0, self._install_error, f"Installation archive not found:\n{zip_path}")
                return

            # Step 3: Extract
            if is_first:
                self.root.after(0, self._update_progress, 20, "Extracting files...")
                log("First install — extracting full archive.")
                install_dir.parent.mkdir(parents=True, exist_ok=True)
                with zipfile.ZipFile(zip_path, "r") as zf:
                    members = zf.namelist()
                    total = len(members)
                    for i, member in enumerate(members):
                        zf.extract(member, install_dir.parent)
                        if i % 50 == 0:
                            pct = 20 + int((i / max(total, 1)) * 55)
                            self.root.after(0, self._update_progress, pct, f"Extracting files... ({i}/{total})")
                log(f"First install extraction complete: {install_dir}")
            else:
                self.root.after(0, self._update_progress, 20, "Preparing update...")
                log(f"Update run — selective update, company_data/ will NOT be touched.")

                if update_tmp_dir.exists():
                    shutil.rmtree(update_tmp_dir)
                    log(f"Removed leftover temp directory: {update_tmp_dir}")

                try:
                    update_tmp_dir.mkdir(parents=True, exist_ok=True)
                    self.root.after(0, self._update_progress, 30, "Extracting update files...")

                    with zipfile.ZipFile(zip_path, "r") as zf:
                        zf.extractall(update_tmp_dir)

                    extracted_root = update_tmp_dir / "LocalBooks"
                    if not extracted_root.exists():
                        raise RuntimeError(
                            f"Expected archive root 'LocalBooks/' not found inside {update_tmp_dir}."
                        )
                    log(f"Archive extracted to temp: {extracted_root}")

                    self.root.after(0, self._update_progress, 50, "Updating files (preserving your data)...")
                    _selective_update(install_dir, extracted_root)

                finally:
                    if update_tmp_dir.exists():
                        try:
                            shutil.rmtree(update_tmp_dir)
                            log(f"Temp directory cleaned up: {update_tmp_dir}")
                        except Exception as e:
                            log(f"WARNING: Could not remove temp directory: {e}")

            # Step 4: Verify executable
            self.root.after(0, self._update_progress, 80, "Verifying installation...")
            target_exe = install_dir / APP_EXE_NAME
            if not target_exe.exists():
                self.root.after(0, self._install_error, f"Expected executable not found:\n{target_exe}")
                return

            # Step 5: Desktop shortcut
            self.root.after(0, self._update_progress, 85, "Creating desktop shortcut...")
            try:
                shortcut_path = get_desktop_path() / "LocalBooks.lnk"
                vbs_path = Path.home() / "AppData" / "Local" / "Temp" / "create_lb_shortcut.vbs"
                vbs_content = (
                    f'Set ws = CreateObject("WScript.Shell")\r\n'
                    f'Set sc = ws.CreateShortcut("{shortcut_path}")\r\n'
                    f'sc.TargetPath = "{target_exe}"\r\n'
                    f'sc.WorkingDirectory = "{install_dir}"\r\n'
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
                vbs_path.unlink(missing_ok=True)
                if result.returncode != 0:
                    log(f"Shortcut VBS stderr: {result.stderr.strip()}")
                else:
                    log(f"Desktop shortcut created: {shortcut_path}")
            except Exception as e:
                log(f"Shortcut error (non-fatal): {e}")

            # Done
            self.root.after(0, self._update_progress, 100, "Installation complete!")
            log("Setup complete.")
            time.sleep(0.5)
            self.root.after(0, self._show_complete)

        except Exception as e:
            log(f"Installation error: {e}")
            self.root.after(0, self._install_error, str(e))

    def _install_error(self, message: str) -> None:
        msgbox("Setup Error", f"Installation failed:\n\n{message}", 0x10)
        sys.exit(1)

    # ----- Screen 4: Completion -----

    def _show_complete(self) -> None:
        tk = self.tk
        ttk = self.ttk
        self._clear()

        title = "Update Complete!" if not self.is_first_install else "Installation Complete!"
        tk.Label(
            self.content, text=title,
            font=("Segoe UI", 14, "bold"), anchor="w",
        ).pack(fill="x", pady=(0, 15))

        tk.Label(
            self.content,
            text=f"LocalBooks has been installed to:\n{self.install_dir}",
            font=("Segoe UI", 9), anchor="w", justify="left",
        ).pack(fill="x", pady=(0, 10))

        tk.Label(
            self.content,
            text="A desktop shortcut has been created.",
            font=("Segoe UI", 9), anchor="w",
        ).pack(fill="x", pady=(0, 20))

        ttk.Checkbutton(
            self.content, text="Launch LocalBooks now",
            variable=self.launch_var,
        ).pack(anchor="w")

        # Spacer
        tk.Frame(self.content).pack(fill="both", expand=True)

        # Finish button
        ttk.Button(self.btn_bar, text="Finish", command=self._on_finish).pack(side="right")

    # ----- Actions -----

    def _on_cancel(self) -> None:
        from tkinter import messagebox
        if messagebox.askyesno("Cancel Setup", "Are you sure you want to cancel?"):
            log("User cancelled setup.")
            sys.exit(0)

    def _on_finish(self) -> None:
        if self.launch_var.get():
            target_exe = self.install_dir / APP_EXE_NAME
            try:
                subprocess.Popen([str(target_exe)], creationflags=0x08000000)
                log("App launched.")
            except Exception as e:
                msgbox("Launch Error", f"Could not launch LocalBooks:\n{e}", 0x10)
        log("Installer finished.")
        self.root.destroy()
        sys.exit(0)

    def run(self) -> None:
        self.root.mainloop()


# ---------------------------------------------------------------------------
# Legacy fallback (MessageBox-only, if Tkinter unavailable)
# ---------------------------------------------------------------------------

def _legacy_main() -> None:
    """Original MessageBox-based installer — used only if Tkinter fails to load."""
    install_dir = DEFAULT_INSTALL_DIR
    update_tmp_dir = install_dir.parent / "LocalBooks_update_tmp"
    is_first_install = not install_dir.exists()

    if is_first_install:
        eula = (
            "LocalBooks Beta - User Agreement\n\n"
            "This software is for educational purposes only.\n"
            "The creator is not liable for any data loss or financial errors.\n"
            "This software is currently in Beta.\n\n"
            "Accept and install LocalBooks to:\n"
            f"{install_dir}\n\n"
            "A Desktop shortcut will be created."
        )
        result = msgbox("LocalBooks Setup", eula, 4 | 64 | 262144)
        if result != 6:
            log("User declined EULA.")
            sys.exit(0)
        log("EULA accepted.")
    else:
        msgbox(
            "LocalBooks Update",
            f"Updating LocalBooks to the latest version.\n\n"
            f"Your company data will not be affected.\n\n"
            f"Installing to: {install_dir}",
            0x40 | 262144,
        )
        log("Update run detected — skipping EULA.")

    try:
        subprocess.run(["taskkill", "/IM", APP_EXE_NAME, "/F"], capture_output=True)
        time.sleep(1)
    except Exception as e:
        log(f"taskkill error: {e}")

    if getattr(sys, "_MEIPASS", None):
        zip_path = Path(sys._MEIPASS) / "LocalBooks.zip"
    else:
        zip_path = Path(__file__).parent / "LocalBooks.zip"

    if not zip_path.exists():
        msgbox("Setup Error", f"Installation archive not found:\n{zip_path}", 0x10)
        sys.exit(1)

    if is_first_install:
        try:
            install_dir.parent.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(zip_path, "r") as zf:
                zf.extractall(install_dir.parent)
            log(f"First install extraction complete: {install_dir}")
        except Exception as e:
            msgbox("Setup Error", f"Extraction failed:\n{e}", 0x10)
            sys.exit(1)
    else:
        if update_tmp_dir.exists():
            try:
                shutil.rmtree(update_tmp_dir)
            except Exception:
                pass
        try:
            update_tmp_dir.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(zip_path, "r") as zf:
                zf.extractall(update_tmp_dir)
            extracted_root = update_tmp_dir / "LocalBooks"
            if not extracted_root.exists():
                raise RuntimeError("Expected archive root 'LocalBooks/' not found.")
            _selective_update(install_dir, extracted_root)
        except Exception as e:
            msgbox("Setup Error", f"Update failed:\n{e}\n\nYour data has NOT been modified.", 0x10)
            sys.exit(1)
        finally:
            if update_tmp_dir.exists():
                try:
                    shutil.rmtree(update_tmp_dir)
                except Exception:
                    pass

    target_exe = install_dir / APP_EXE_NAME
    if not target_exe.exists():
        msgbox("Setup Error", f"Executable not found:\n{target_exe}", 0x10)
        sys.exit(1)

    try:
        shortcut_path = get_desktop_path() / "LocalBooks.lnk"
        vbs_path = Path.home() / "AppData" / "Local" / "Temp" / "create_lb_shortcut.vbs"
        vbs_content = (
            f'Set ws = CreateObject("WScript.Shell")\r\n'
            f'Set sc = ws.CreateShortcut("{shortcut_path}")\r\n'
            f'sc.TargetPath = "{target_exe}"\r\n'
            f'sc.WorkingDirectory = "{install_dir}"\r\n'
            f'sc.IconLocation = "{target_exe}, 0"\r\n'
            f'sc.Description = "LocalBooks - Local Bookkeeping"\r\n'
            f'sc.Save()\r\n'
        )
        vbs_path.write_text(vbs_content, encoding="utf-8")
        result = subprocess.run(
            [r"C:\Windows\System32\cscript.exe", "//Nologo", str(vbs_path)],
            capture_output=True, text=True, timeout=15,
        )
        vbs_path.unlink(missing_ok=True)
    except Exception as e:
        log(f"Shortcut error (non-fatal): {e}")

    try:
        subprocess.Popen([str(target_exe)], creationflags=0x08000000)
    except Exception as e:
        msgbox("Setup Error", f"Could not launch LocalBooks:\n{e}", 0x10)
        sys.exit(1)

    msgbox(
        "LocalBooks Installed!",
        f"LocalBooks has been installed to:\n{install_dir}\n\n"
        "A Desktop shortcut has been created.\nThe app is opening in your browser now!",
        0x40,
    )
    sys.exit(0)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    log("=== LocalBooks Setup starting ===")
    try:
        import tkinter  # noqa: F401 — test availability
        wizard = InstallerWizard()
        wizard.run()
    except ImportError:
        log("Tkinter not available — falling back to legacy MessageBox installer.")
        _legacy_main()


if __name__ == "__main__":
    main()
