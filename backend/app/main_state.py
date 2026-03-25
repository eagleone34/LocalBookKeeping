"""
Application state management.
Holds the database connection and company ID for the current session.
"""
from __future__ import annotations

import sqlite3
from contextvars import ContextVar
from pathlib import Path
from typing import Optional

_conn: Optional[sqlite3.Connection] = None
_company_id: ContextVar[int] = ContextVar("company_id", default=1)
_data_dir: Optional[Path] = None
_upload_dir: Optional[Path] = None

# Preview mode: when set, get_conn() returns a read-only connection to a backup DB.
_preview_conn: Optional[sqlite3.Connection] = None
_preview_backup_filename: Optional[str] = None


def init_state(conn: sqlite3.Connection, company_id: int, data_dir: Path) -> None:
    global _conn, _data_dir, _upload_dir
    _conn = conn
    _company_id.set(company_id)
    _data_dir = data_dir
    _upload_dir = data_dir / "uploads"
    _upload_dir.mkdir(parents=True, exist_ok=True)


def set_company_id(cid: int) -> None:
    _company_id.set(cid)


def get_conn() -> sqlite3.Connection:
    """Return the active DB connection.

    If preview mode is active, returns the read-only backup connection instead
    of the live database connection.
    """
    if _preview_conn is not None:
        return _preview_conn
    assert _conn is not None, "Database not initialized"
    return _conn


def get_live_conn() -> sqlite3.Connection:
    """Always return the live (non-preview) DB connection."""
    assert _conn is not None, "Database not initialized"
    return _conn


def get_company_id() -> int:
    cid = _company_id.get()
    assert cid > 0, "Company not initialized"
    return cid


def get_data_dir() -> Path:
    assert _data_dir is not None, "Data dir not initialized"
    return _data_dir


def get_upload_dir() -> Path:
    assert _upload_dir is not None, "Upload dir not initialized"
    return _upload_dir


# ── Preview mode ──────────────────────────────────────────────────────────────

def enter_preview_mode(backup_path: Path, backup_filename: str) -> None:
    """Open a read-only connection to *backup_path* and activate preview mode."""
    global _preview_conn, _preview_backup_filename
    if _preview_conn is not None:
        try:
            _preview_conn.close()
        except Exception:
            pass
    # Open as read-only via URI
    uri = backup_path.as_uri() + "?mode=ro"
    conn = sqlite3.connect(uri, uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    _preview_conn = conn
    _preview_backup_filename = backup_filename


def exit_preview_mode() -> None:
    """Close the preview connection and return to live data."""
    global _preview_conn, _preview_backup_filename
    if _preview_conn is not None:
        try:
            _preview_conn.close()
        except Exception:
            pass
    _preview_conn = None
    _preview_backup_filename = None


def is_preview_mode() -> bool:
    return _preview_conn is not None


def get_preview_filename() -> Optional[str]:
    return _preview_backup_filename
