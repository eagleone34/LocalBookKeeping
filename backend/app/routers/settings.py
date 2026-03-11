"""
Settings & System API endpoints.
"""
from __future__ import annotations

from pathlib import Path
from typing import List

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.models import CompanyOut, CompanyUpdate, RuleCreate, RuleOut, VendorOut
from app.main_state import get_conn, get_company_id, get_data_dir
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
    conn = get_conn()
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
    conn = get_conn()

    # Safety: don't delete the last company
    count = conn.execute("SELECT COUNT(*) as cnt FROM company").fetchone()["cnt"]
    if count <= 1:
        raise HTTPException(400, "Cannot delete the last company.")

    # Verify company exists
    row = conn.execute("SELECT id FROM company WHERE id=?", (company_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Company not found")

    # Cascade delete all related data
    # 1. Delete document_transactions (linked via documents)
    conn.execute("""
        DELETE FROM document_transactions WHERE document_id IN
        (SELECT id FROM documents WHERE company_id=?)
    """, (company_id,))
    # 2. Documents
    conn.execute("DELETE FROM documents WHERE company_id=?", (company_id,))
    # 3. Transactions
    conn.execute("DELETE FROM transactions WHERE company_id=?", (company_id,))
    # 4. Budgets
    conn.execute("DELETE FROM budgets WHERE company_id=?", (company_id,))
    # 5. Categorization rules
    conn.execute("DELETE FROM categorization_rules WHERE company_id=?", (company_id,))
    # 6. Vendor-account map
    conn.execute("DELETE FROM vendor_account_map WHERE company_id=?", (company_id,))
    # 7. Bank accounts
    conn.execute("DELETE FROM bank_accounts WHERE company_id=?", (company_id,))
    # 8. Vendors
    conn.execute("DELETE FROM vendors WHERE company_id=?", (company_id,))
    # 9. Accounts
    conn.execute("DELETE FROM accounts WHERE company_id=?", (company_id,))
    # 10. Audit log
    conn.execute("DELETE FROM audit_log WHERE company_id=?", (company_id,))
    # 11. Finally, the company itself
    conn.execute("DELETE FROM company WHERE id=?", (company_id,))
    conn.commit()

    return {"ok": True, "deleted_company_id": company_id}


@router.put("/company", response_model=CompanyOut)
def update_company(body: CompanyUpdate):
    kwargs = body.model_dump(exclude_none=True)
    ds.update_company(get_conn(), get_company_id(), **kwargs)
    row = ds.get_company(get_conn(), get_company_id())
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
        get_conn(), get_company_id(),
        body.pattern, body.match_type, body.account_id, body.priority,
    )
    return {"id": rid, "ok": True}


@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: int):
    ds.delete_rule(get_conn(), rule_id)
    return {"ok": True}


# ── Backup ──
@router.post("/backup")
def create_backup():
    """Create a database backup."""
    import shutil
    from datetime import datetime
    data_dir = get_data_dir()
    db_path = data_dir / "ledgerlocal.db"
    backup_dir = data_dir / "backups"
    backup_dir.mkdir(exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    backup_path = backup_dir / f"ledgerlocal_backup_{timestamp}.db"
    try:
        get_conn().execute("PRAGMA wal_checkpoint(FULL)")
        shutil.copy2(str(db_path), str(backup_path))
        return {"ok": True, "backup_path": str(backup_path)}
    except Exception as e:
        raise HTTPException(500, f"Backup failed: {e}")


@router.get("/backups")
def list_backups():
    """List available backups."""
    data_dir = get_data_dir()
    backup_dir = data_dir / "backups"
    if not backup_dir.exists():
        return []
    backups = []
    for f in sorted(backup_dir.glob("*.db"), reverse=True):
        backups.append({
            "filename": f.name,
            "size": f.stat().st_size,
            "created": f.stat().st_mtime,
        })
    return backups
