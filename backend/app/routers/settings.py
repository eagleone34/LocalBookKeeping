"""
Settings & System API endpoints.
"""
from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.models import CompanyOut, CompanyUpdate, RuleCreate, RuleOut, VendorOut
from app.main_state import (
    get_conn, get_live_conn, get_company_id, get_data_dir,
    enter_preview_mode, exit_preview_mode, is_preview_mode, get_preview_filename,
)
from app.services import data_service as ds

router = APIRouter(prefix="/api", tags=["settings"])


@router.get("/company", response_model=CompanyOut)
def get_company():
    row = ds.get_company(get_conn(), get_company_id())
    if not row:
        raise HTTPException(404, "Company not found")
    return CompanyOut(**row)


@router.get("/companies", response_model=List[CompanyOut])
def list_companies():
    rows = get_conn().execute("SELECT * FROM company ORDER BY id").fetchall()
    return [CompanyOut(**r) for r in rows]


class CompanyCreate(BaseModel):
    name: str
    currency: str = "USD"


@router.post("/companies", response_model=CompanyOut)
def create_company(body: CompanyCreate):
    conn = get_live_conn()
    now = ds._now()
    cur = conn.execute(
        "INSERT INTO company (name, currency, fiscal_year_start, created_at, updated_at) VALUES (?,?,1,?,?)",
        (body.name, body.currency, now, now),
    )
    conn.commit()
    new_cid = int(cur.lastrowid)

    from app.services.seed_data import seed_default_accounts
    seed_default_accounts(conn, new_cid)

    row = ds.get_company(conn, new_cid)
    return CompanyOut(**row)


@router.delete("/companies/{company_id}")
def delete_company(company_id: int):
    """Delete a company and all its associated data (cascading)."""
    conn = get_live_conn()

    # Safety: don't delete the last company
    count = conn.execute("SELECT COUNT(*) as cnt FROM company").fetchone()["cnt"]
    if count <= 1:
        raise HTTPException(400, "Cannot delete the last company.")

    # Verify company exists
    row = conn.execute("SELECT id FROM company WHERE id=?", (company_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Company not found")

    # Cascade delete all related data
    conn.execute("""
        DELETE FROM document_transactions WHERE document_id IN
        (SELECT id FROM documents WHERE company_id=?)
    """, (company_id,))
    conn.execute("DELETE FROM documents WHERE company_id=?", (company_id,))
    conn.execute("DELETE FROM transactions WHERE company_id=?", (company_id,))
    conn.execute("DELETE FROM budgets WHERE company_id=?", (company_id,))
    conn.execute("DELETE FROM categorization_rules WHERE company_id=?", (company_id,))
    conn.execute("DELETE FROM vendor_account_map WHERE company_id=?", (company_id,))
    conn.execute("DELETE FROM bank_accounts WHERE company_id=?", (company_id,))
    conn.execute("DELETE FROM vendors WHERE company_id=?", (company_id,))
    conn.execute("DELETE FROM accounts WHERE company_id=?", (company_id,))
    conn.execute("DELETE FROM audit_log WHERE company_id=?", (company_id,))
    conn.execute("DELETE FROM company WHERE id=?", (company_id,))
    conn.commit()

    return {"ok": True, "deleted_company_id": company_id}


@router.put("/company", response_model=CompanyOut)
def update_company(body: CompanyUpdate):
    conn = get_live_conn()
    kwargs = body.model_dump(exclude_none=True)
    ds.update_company(conn, get_company_id(), **kwargs)
    row = ds.get_company(conn, get_company_id())
    return CompanyOut(**row)


@router.get("/vendors", response_model=List[VendorOut])
def list_vendors():
    rows = ds.list_vendors(get_conn(), get_company_id())
    return [VendorOut(id=r["id"], name=r["name"]) for r in rows]


# ── Categorization Rules ──
@router.get("/rules", response_model=List[RuleOut])
def list_rules():
    rows = ds.list_rules(get_conn(), get_company_id())
    return [RuleOut(
        id=r["id"], pattern=r["pattern"], match_type=r["match_type"],
        account_id=r["account_id"], account_name=r.get("account_name", ""),
        priority=r["priority"], is_active=bool(r["is_active"]),
    ) for r in rows]


@router.post("/rules", status_code=201)
def create_rule(body: RuleCreate):
    rid = ds.create_rule(
        get_live_conn(), get_company_id(),
        body.pattern, body.match_type, body.account_id, body.priority,
    )
    return {"id": rid, "ok": True}


@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: int):
    ds.delete_rule(get_live_conn(), rule_id)
    return {"ok": True}


# ── Backup ──────────────────────────────────────────────────────────────────

def _backup_dir() -> Path:
    data_dir = get_data_dir()
    backup_dir = data_dir / "backups"
    backup_dir.mkdir(exist_ok=True)
    return backup_dir


def _backup_info(f: Path) -> dict:
    """Return a dict describing a single backup file."""
    stat = f.stat()
    # Parse timestamp from filename: ledgerlocal_backup_YYYYMMDD_HHMMSS.db
    created_iso: Optional[str] = None
    try:
        parts = f.stem.split("_")
        # stem looks like: ledgerlocal_backup_20260315_142305
        date_part = parts[-2]   # 20260315
        time_part = parts[-1]   # 142305
        dt = datetime.strptime(f"{date_part}_{time_part}", "%Y%m%d_%H%M%S")
        created_iso = dt.isoformat()
    except Exception:
        # Fall back to file mtime
        created_iso = datetime.utcfromtimestamp(stat.st_mtime).isoformat()

    return {
        "filename": f.name,
        "size": stat.st_size,
        "created_at": created_iso,
        "is_preview": (get_preview_filename() == f.name),
    }


@router.post("/backup")
def create_backup():
    """Create a database backup."""
    data_dir = get_data_dir()
    db_path = data_dir / "ledgerlocal.db"
    backup_dir = _backup_dir()
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    backup_path = backup_dir / f"ledgerlocal_backup_{timestamp}.db"
    try:
        get_live_conn().execute("PRAGMA wal_checkpoint(FULL)")
        shutil.copy2(str(db_path), str(backup_path))
        return {"ok": True, "backup": _backup_info(backup_path)}
    except Exception as e:
        raise HTTPException(500, f"Backup failed: {e}")


@router.get("/backups")
def list_backups():
    """List available backups, newest first."""
    backup_dir = _backup_dir()
    files = sorted(backup_dir.glob("*.db"), reverse=True)
    return [_backup_info(f) for f in files]


@router.delete("/backups/{filename}")
def delete_backup(filename: str):
    """Permanently delete a backup file."""
    # Safety: disallow path traversal
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "Invalid filename")
    backup_path = _backup_dir() / filename
    if not backup_path.exists():
        raise HTTPException(404, "Backup not found")
    # Cannot delete the currently-previewed backup
    if get_preview_filename() == filename:
        raise HTTPException(400, "Cannot delete a backup that is currently being previewed. Exit preview first.")
    backup_path.unlink()
    return {"ok": True}


# ── Preview mode ─────────────────────────────────────────────────────────────

@router.get("/backup-preview-status")
def backup_preview_status():
    """Return current preview mode status."""
    filename = get_preview_filename()
    if not filename:
        return {"preview_active": False, "filename": None, "created_at": None}

    backup_dir = _backup_dir()
    backup_path = backup_dir / filename
    created_at = None
    if backup_path.exists():
        info = _backup_info(backup_path)
        created_at = info.get("created_at")

    return {
        "preview_active": True,
        "filename": filename,
        "created_at": created_at,
    }


@router.post("/backups/{filename}/preview")
def start_preview(filename: str):
    """Switch the app into preview mode using the specified backup."""
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "Invalid filename")
    backup_path = _backup_dir() / filename
    if not backup_path.exists():
        raise HTTPException(404, "Backup not found")
    try:
        enter_preview_mode(backup_path, filename)
    except Exception as e:
        raise HTTPException(500, f"Could not open backup for preview: {e}")
    info = _backup_info(backup_path)
    return {"ok": True, "preview_active": True, "filename": filename, "created_at": info.get("created_at")}


@router.post("/backup-preview/exit")
def exit_preview():
    """Exit preview mode and return to live data."""
    exit_preview_mode()
    return {"ok": True, "preview_active": False}


@router.post("/backups/{filename}/restore")
def restore_backup(filename: str):
    """
    Permanently restore a backup as the live database.

    Steps:
    1. Exit preview mode (if active).
    2. Checkpoint the live WAL.
    3. Copy the backup over the live DB.
    4. The caller must reload the page — the server keeps running but the
       in-memory SQLite connection now points at stale data.  A full server
       restart is the cleanest approach; here we do a hot-swap by re-opening
       the connection in-place.
    """
    import app.main_state as state

    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "Invalid filename")

    backup_path = _backup_dir() / filename
    if not backup_path.exists():
        raise HTTPException(404, "Backup not found")

    # Exit preview first so we release the read-only handle
    exit_preview_mode()

    data_dir = get_data_dir()
    live_db_path = data_dir / "ledgerlocal.db"

    try:
        # Checkpoint live WAL before overwriting
        live_conn = get_live_conn()
        try:
            live_conn.execute("PRAGMA wal_checkpoint(FULL)")
        except Exception:
            pass

        # Copy backup → live
        shutil.copy2(str(backup_path), str(live_db_path))

        # Hot-swap: re-open the live connection so the running server sees the
        # restored data without needing a full restart.
        from app.database import connect, init_schema
        new_conn = connect(str(live_db_path))
        init_schema(new_conn)

        # Replace the global connection
        state._conn = new_conn

        # Re-derive company_id from the restored DB
        from app.services.data_service import ensure_company
        company_id = ensure_company(new_conn, "Demo Company", "USD")
        state._company_id.set(company_id)

        return {"ok": True, "message": f"Database restored from {filename}. Please refresh the page."}
    except Exception as e:
        raise HTTPException(500, f"Restore failed: {e}")
