"""
LocalBooks Backup Service
=========================
Handles APPDATA-based rolling DB backups and post-install restore detection.

Design rules:
  - STDLIB ONLY.  No FastAPI, no uvicorn, no third-party packages.
    This ensures the module can be imported from both the main app and
    (if ever needed) from the standalone bootstrapper installer.
  - All operations are logged both via the standard Python ``logging``
    module AND to an optional caller-supplied log file path.
  - Failures are always caught and returned as False/None — never
    propagated as exceptions to the caller.

Backup layout on disk::

    %APPDATA%\\LocalBooks\\
        backups\\
            2026-03-24_020000\\
                ledgerlocal.db
                meta.json
            2026-01-10_153042\\
                ...
        restore_pending.json   ← written by bootstrapper, cleared by main.py
"""
from __future__ import annotations

import json
import logging
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
_APPDATA = os.environ.get("APPDATA", "")
APPDATA_BASE: Path = (
    Path(_APPDATA) / "LocalBooks" if _APPDATA else Path.home() / "AppData" / "Roaming" / "LocalBooks"
)
BACKUPS_DIR: Path = APPDATA_BASE / "backups"
RESTORE_SENTINEL: Path = APPDATA_BASE / "restore_pending.json"

MAX_BACKUPS = 10  # keep only the N most recent timestamped backup folders


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _log(msg: str, log_path: Optional[Path] = None) -> None:
    """Write to Python logger AND, optionally, to a persistent log file."""
    logger.info(msg)
    if log_path:
        try:
            log_path.parent.mkdir(parents=True, exist_ok=True)
            with open(log_path, "a", encoding="utf-8") as fh:
                fh.write(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} [backup] {msg}\n")
        except Exception:
            pass


def _prune_old_backups(log_path: Optional[Path] = None) -> None:
    """Remove oldest backup folders beyond MAX_BACKUPS."""
    if not BACKUPS_DIR.exists():
        return
    folders = sorted(
        [d for d in BACKUPS_DIR.iterdir() if d.is_dir()],
        key=lambda d: d.name,
        reverse=True,
    )
    for old in folders[MAX_BACKUPS:]:
        try:
            shutil.rmtree(old)
            _log(f"Pruned old backup folder: {old}", log_path)
        except Exception as exc:
            _log(f"WARNING: Could not prune {old}: {exc}", log_path)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def create_backup(
    data_dir: Path,
    log_path: Optional[Path] = None,
) -> Optional[Path]:
    """Copy every ``*.db`` file in *data_dir* to a timestamped folder under
    ``%APPDATA%\\LocalBooks\\backups\\``.

    Returns the backup folder :class:`~pathlib.Path` on success, ``None`` on
    failure or if there is nothing to back up.
    """
    db_files = list(data_dir.glob("*.db"))
    if not db_files:
        _log(f"No *.db files found in {data_dir} — nothing to back up.", log_path)
        return None

    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    backup_folder = BACKUPS_DIR / timestamp

    try:
        backup_folder.mkdir(parents=True, exist_ok=True)

        backed_up: list[str] = []
        for db_file in db_files:
            dest = backup_folder / db_file.name
            shutil.copy2(db_file, dest)
            # Verify integrity by comparing byte sizes
            src_size = db_file.stat().st_size
            dst_size = dest.stat().st_size
            if src_size != dst_size:
                raise RuntimeError(
                    f"Size mismatch after copy: {db_file.name} "
                    f"src={src_size} dst={dst_size}"
                )
            backed_up.append(db_file.name)
            _log(
                f"Backed up {db_file.name} ({src_size:,} bytes) → {dest}",
                log_path,
            )

        # Write metadata alongside the DB files
        meta = {
            "timestamp": timestamp,
            "source_dir": str(data_dir),
            "files": backed_up,
            "created_at": datetime.now().isoformat(),
        }
        (backup_folder / "meta.json").write_text(
            json.dumps(meta, indent=2), encoding="utf-8"
        )

        _log(f"Backup complete → {backup_folder}", log_path)
        _prune_old_backups(log_path)
        return backup_folder

    except Exception as exc:
        _log(f"ERROR: Backup failed: {exc}", log_path)
        # Clean up partial backup folder so it is not mistaken for a valid backup
        try:
            if backup_folder.exists():
                shutil.rmtree(backup_folder)
        except Exception:
            pass
        return None


def write_restore_sentinel(
    backup_folder: Path,
    log_path: Optional[Path] = None,
) -> None:
    """Write ``restore_pending.json`` to APPDATA so that
    :func:`check_and_restore` picks it up on the next app startup.

    Called by the bootstrapper *before* it wipes the install directory.
    If the bootstrapper's inline restore succeeds, it calls
    :func:`clear_restore_sentinel` immediately after.  The sentinel is
    therefore only consumed by :func:`check_and_restore` in ``main.py``
    when the bootstrapper crashed after extraction but before its own
    restore completed.
    """
    try:
        APPDATA_BASE.mkdir(parents=True, exist_ok=True)
        sentinel = {
            "backup_folder": str(backup_folder),
            "written_at": datetime.now().isoformat(),
        }
        RESTORE_SENTINEL.write_text(
            json.dumps(sentinel, indent=2), encoding="utf-8"
        )
        _log(f"Restore sentinel written: {RESTORE_SENTINEL}", log_path)
    except Exception as exc:
        _log(f"WARNING: Could not write restore sentinel: {exc}", log_path)


def clear_restore_sentinel(log_path: Optional[Path] = None) -> None:
    """Remove the restore sentinel.  Called after a successful inline restore
    by the bootstrapper so that ``main.py`` does not attempt a second restore.
    """
    try:
        if RESTORE_SENTINEL.exists():
            RESTORE_SENTINEL.unlink()
            _log("Restore sentinel cleared.", log_path)
    except Exception as exc:
        _log(f"WARNING: Could not clear restore sentinel: {exc}", log_path)


def check_and_restore(
    data_dir: Path,
    log_path: Optional[Path] = None,
) -> bool:
    """Called from ``main.py`` on startup (frozen mode only).

    If a ``restore_pending.json`` sentinel exists and the referenced backup
    is newer than the current DB, restores all ``*.db`` files from the backup
    folder into *data_dir*.

    Returns ``True`` if a restore was performed, ``False`` otherwise.
    """
    if not RESTORE_SENTINEL.exists():
        return False

    try:
        sentinel_text = RESTORE_SENTINEL.read_text(encoding="utf-8")
        sentinel = json.loads(sentinel_text)
        backup_folder = Path(sentinel["backup_folder"])

        if not backup_folder.exists():
            _log(
                f"Restore sentinel points to non-existent folder: {backup_folder}",
                log_path,
            )
            clear_restore_sentinel(log_path)
            return False

        # Only restore when the backup is strictly newer than the current DB.
        # This prevents accidentally overwriting data the user created AFTER a
        # successful inline restore by the bootstrapper.
        current_db = data_dir / "ledgerlocal.db"
        backup_db = backup_folder / "ledgerlocal.db"

        if current_db.exists() and backup_db.exists():
            backup_mtime = backup_db.stat().st_mtime
            current_mtime = current_db.stat().st_mtime
            if backup_mtime <= current_mtime:
                _log(
                    "Restore sentinel exists but backup is not newer than the current "
                    "DB — bootstrapper already restored successfully; skipping.",
                    log_path,
                )
                clear_restore_sentinel(log_path)
                return False

        # Perform restore
        db_files = list(backup_folder.glob("*.db"))
        if not db_files:
            _log(
                f"No *.db files in backup folder {backup_folder} — nothing to restore.",
                log_path,
            )
            clear_restore_sentinel(log_path)
            return False

        _log(f"Restoring {len(db_files)} DB file(s) from {backup_folder}", log_path)
        data_dir.mkdir(parents=True, exist_ok=True)

        restored = 0
        for db_file in db_files:
            dest = data_dir / db_file.name
            shutil.copy2(db_file, dest)
            _log(
                f"Restored {db_file.name} ({db_file.stat().st_size:,} bytes) → {dest}",
                log_path,
            )
            restored += 1

        clear_restore_sentinel(log_path)
        _log(f"Post-install restore complete: {restored} file(s) restored.", log_path)
        return True

    except Exception as exc:
        _log(f"ERROR: check_and_restore failed: {exc}", log_path)
        return False


def find_latest_backup() -> Optional[Path]:
    """Return the most recent timestamped backup folder, or ``None`` if no
    backups exist.
    """
    if not BACKUPS_DIR.exists():
        return None
    folders = sorted(
        [d for d in BACKUPS_DIR.iterdir() if d.is_dir() and (d / "meta.json").exists()],
        key=lambda d: d.name,
        reverse=True,
    )
    return folders[0] if folders else None
