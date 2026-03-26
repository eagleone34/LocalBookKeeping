"""
Bank Reconciliation API endpoints.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException

from app.models import ReconciliationCreate, ReconciliationOut, ReconciliationStatusOut, LedgerRow
from app.main_state import get_conn, get_live_conn, get_company_id
from app.services import data_service as ds

router = APIRouter(prefix="/api/reconciliation", tags=["reconciliation"])


@router.get("/{bank_account_id}/status", response_model=ReconciliationStatusOut)
def get_reconciliation_status(bank_account_id: int):
    """
    Return the current reconciliation status for a bank account:
    - Last reconciled date & balance
    - Current LocalBooks balance
    - All unreconciled transactions with running balance
    """
    conn = get_conn()
    company_id = get_company_id()

    ba = ds.get_bank_account(conn, bank_account_id)
    if not ba or ba["company_id"] != company_id:
        raise HTTPException(404, "Bank account not found")

    status = ds.get_reconciliation_status(conn, company_id, bank_account_id)

    return ReconciliationStatusOut(
        bank_account_id=status["bank_account_id"],
        bank_name=status["bank_name"],
        last_four=status["last_four"],
        last_reconciled_date=status.get("last_reconciled_date"),
        last_reconciled_balance=status.get("last_reconciled_balance"),
        localbooks_balance_today=status["localbooks_balance_today"],
        unreconciled_count=status["unreconciled_count"],
        unreconciled_transactions=[
            LedgerRow(
                id=r["id"],
                txn_date=r["txn_date"],
                vendor_name=r.get("vendor_name"),
                description=r.get("description"),
                amount=r["amount"],
                running_balance=r["running_balance"],
                is_reconciled=bool(r.get("is_reconciled", 0)),
                reconciliation_id=r.get("reconciliation_id"),
                source=r.get("source", "manual"),
                bank_account_id=r.get("bank_account_id"),
            )
            for r in status["unreconciled_transactions"]
        ],
    )


@router.get("/{bank_account_id}/balance-as-of")
def get_balance_as_of(bank_account_id: int, date: str):
    """
    Return the LocalBooks balance for a bank account as of a specific date.
    Used to preview the balance before committing a reconciliation.
    """
    conn = get_conn()
    company_id = get_company_id()

    ba = ds.get_bank_account(conn, bank_account_id)
    if not ba or ba["company_id"] != company_id:
        raise HTTPException(404, "Bank account not found")

    balance = ds.get_localbooks_balance_as_of(conn, company_id, bank_account_id, date)
    return {"bank_account_id": bank_account_id, "as_of_date": date, "balance": round(balance, 2)}


@router.post("/{bank_account_id}", response_model=ReconciliationOut)
def save_reconciliation(bank_account_id: int, body: ReconciliationCreate):
    """
    Save a reconciliation.
    - Calculates LocalBooks balance as of statement_date
    - Computes difference vs statement_balance
    - Marks selected transaction_ids as reconciled
    - Saves reconciliation record
    """
    conn = get_live_conn()
    company_id = get_company_id()

    ba = ds.get_bank_account(conn, bank_account_id)
    if not ba or ba["company_id"] != company_id:
        raise HTTPException(404, "Bank account not found")

    localbooks_balance = ds.get_localbooks_balance_as_of(
        conn, company_id, bank_account_id, body.statement_date
    )

    rec_id = ds.save_reconciliation(
        conn,
        company_id=company_id,
        bank_account_id=bank_account_id,
        reconciled_date=body.statement_date,
        statement_balance=body.statement_balance,
        localbooks_balance=localbooks_balance,
        transaction_ids=body.transaction_ids,
        notes=body.notes,
    )

    # Fetch and return the saved record
    row = conn.execute("SELECT * FROM reconciliations WHERE id=?", (rec_id,)).fetchone()
    if not row:
        raise HTTPException(500, "Reconciliation saved but not found")

    return _to_out(dict(row))


@router.get("/{bank_account_id}/history", response_model=List[ReconciliationOut])
def list_reconciliation_history(bank_account_id: int):
    """Return all past reconciliations for a bank account, newest first."""
    conn = get_conn()
    company_id = get_company_id()

    ba = ds.get_bank_account(conn, bank_account_id)
    if not ba or ba["company_id"] != company_id:
        raise HTTPException(404, "Bank account not found")

    rows = ds.list_reconciliations(conn, company_id, bank_account_id)
    return [_to_out(r) for r in rows]


def _to_out(row: dict) -> ReconciliationOut:
    return ReconciliationOut(
        id=row["id"],
        company_id=row["company_id"],
        bank_account_id=row["bank_account_id"],
        reconciled_date=row["reconciled_date"],
        statement_balance=row["statement_balance"],
        localbooks_balance=row["localbooks_balance"],
        difference=row["difference"],
        status=row["status"],
        notes=row.get("notes"),
        created_at=row["created_at"],
    )
