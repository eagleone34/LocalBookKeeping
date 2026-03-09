"""
Application state management.
Holds the database connection and company ID for the current session.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Optional

_conn: Optional[sqlite3.Connection] = None
_company_id: int = 0
_data_dir: Optional[Path] = None
_upload_dir: Optional[Path] = None


def init_state(conn: sqlite3.Connection, company_id: int, data_dir: Path) -> None:
    global _conn, _company_id, _data_dir, _upload_dir
    _conn = conn
    _company_id = company_id
    _data_dir = data_dir
    _upload_dir = data_dir / "uploads"
    _upload_dir.mkdir(parents=True, exist_ok=True)


def get_conn() -> sqlite3.Connection:
    assert _conn is not None, "Database not initialized"
    return _conn


def get_company_id() -> int:
    assert _company_id > 0, "Company not initialized"
    return _company_id


def get_data_dir() -> Path:
    assert _data_dir is not None, "Data dir not initialized"
    return _data_dir


def get_upload_dir() -> Path:
    assert _upload_dir is not None, "Upload dir not initialized"
    return _upload_dir
