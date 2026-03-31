"""
Accounts API endpoints — including balance, ledger drill-down, and bank account management.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException

from app.models import (
    AccountCreate, AccountOut, AccountUpdate,
    BankAccountCreate, BankAccountOut,
    AccountBalanceOut, LedgerRow,
)
from app.main_state import get_conn, get_live_conn, get_company_id
from app.services import data_service as ds

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


# ── Static routes MUST come before dynamic /{account_id}/... routes ──────────
# FastAPI matches routes in registration order. If /{account_id}/balance is
# registered before /balances/all, then GET /api/accounts/balances/all will
# try to parse "balances" as an integer account_id and return a 422 error.


@router.get("/balances/all")
def get_all_account_balances():
    """
    Return balances for all asset/liability accounts that have a linked bank account.
    Used by the Accounts page to show balances inline.
    Returns a dict of {ledger_account_id: balance}.
    """
    conn = get_conn()
    company_id = get_company_id()
    balance_map = ds.get_account_balances_for_company(conn, company_id)
    return balance_map


@router.get("/bank-accounts", response_model=List[BankAccountOut])
def list_bank_accounts():
    rows = ds.list_bank_accounts(get_conn(), get_company_id())
    return [_bank_to_out(r) for r in rows]


@router.post("/bank-accounts", response_model=BankAccountOut, status_code=201)
def create_bank_account(body: BankAccountCreate):
    conn = get_live_conn()
    company_id = get_company_id()

    if body.account_type == "credit_card":
        coa_type = "liability"
        label = "Credit Card"
    elif body.account_type == "savings":
        coa_type = "asset"
        label = "Savings"
    else:
        coa_type = "asset"
        label = "Checking"

    masked = f"****{body.last_four}" if body.last_four else ""
    coa_name = f"{body.bank_name} {label} {masked}".strip()

    existing_coa = conn.execute(
        "SELECT id FROM accounts WHERE company_id=? AND name=? AND type=?",
        (company_id, coa_name, coa_type),
    ).fetchone()

    if existing_coa:
        ledger_account_id = int(existing_coa["id"])
    else:
        ledger_account_id = ds.create_account(
            conn, company_id, coa_name, coa_type,
            description=f"Auto-created for {body.bank_name} {body.last_four}",
        )

    bank_id = ds.upsert_bank_account(
        conn, company_id,
        bank_name=body.bank_name,
        last_four=body.last_four,
        full_number=body.full_number or "",
        nickname=body.nickname or "",
        ledger_account_id=ledger_account_id,
    )

    ba = ds.get_bank_account(conn, bank_id)
    if ba and not ba.get("ledger_account_id"):
        ds.update_bank_account(conn, bank_id, ledger_account_id=ledger_account_id)

    row = ds.find_bank_account_by_last_four(conn, company_id, body.bank_name, body.last_four)
    if not row:
        raise HTTPException(500, "Bank account created but not found")
    return _bank_to_out(row)


@router.put("/bank-accounts/{bank_account_id}")
def update_bank_account(bank_account_id: int, body: dict):
    ds.update_bank_account(get_live_conn(), bank_account_id, **body)
    return {"ok": True}


# ── Standard CRUD (no path conflicts below here) ──────────────────────────────

@router.get("", response_model=List[AccountOut])
def list_accounts(include_inactive: bool = False):
    rows = ds.list_accounts(get_conn(), get_company_id(), include_inactive)
    return [_to_out(r) for r in rows]


@router.post("", response_model=AccountOut, status_code=201)
def create_account(body: AccountCreate):
    aid = ds.create_account(
        get_live_conn(), get_company_id(), body.name, body.type,
        body.parent_id, body.code, body.description, currency=body.currency,
    )
    row = ds.get_account(get_live_conn(), aid)
    return _to_out(row)


# ── Dynamic /{account_id}/... routes — registered AFTER all static routes ─────

@router.get("/{account_id}/balance", response_model=AccountBalanceOut)
def get_account_balance(account_id: int):
    """
    Return the current balance for an asset/liability account.
    Balance is computed from all transactions linked via bank_account → ledger_account.
    Also returns last reconciliation info if available.
    """
    conn = get_conn()
    company_id = get_company_id()

    acc = ds.get_account(conn, account_id)
    if not acc:
        raise HTTPException(404, "Account not found")

    balance = ds.get_account_balance(conn, company_id, account_id)

    # Find linked bank account (if any)
    ba_row = conn.execute(
        "SELECT * FROM bank_accounts WHERE company_id=? AND ledger_account_id=? LIMIT 1",
        (company_id, account_id),
    ).fetchone()

    last_rec = None
    bank_account_id = None
    bank_name = None
    last_four = None

    if ba_row:
        bank_account_id = int(ba_row["id"])
        bank_name = ba_row["bank_name"]
        last_four = ba_row["last_four"]
        last_rec = ds.get_last_reconciliation(conn, company_id, bank_account_id)

    return AccountBalanceOut(
        account_id=account_id,
        account_name=acc["name"],
        account_type=acc["type"],
        balance=round(balance, 2),
        currency=acc.get("currency", "USD") or "USD",
        bank_account_id=bank_account_id,
        bank_name=bank_name,
        last_four=last_four,
        last_reconciled_date=last_rec["reconciled_date"] if last_rec else None,
        last_reconciled_balance=float(last_rec["statement_balance"]) if last_rec else None,
    )


@router.get("/{account_id}/ledger", response_model=List[LedgerRow])
def get_account_ledger(
    account_id: int,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    """
    Return all transactions for a ledger account with running balance.
    Sorted oldest → newest.
    """
    conn = get_conn()
    company_id = get_company_id()

    acc = ds.get_account(conn, account_id)
    if not acc:
        raise HTTPException(404, "Account not found")

    rows = ds.get_account_ledger(conn, company_id, account_id, date_from, date_to)
    return [
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
        for r in rows
    ]


@router.get("/{account_id}/transaction-count")
def account_transaction_count(account_id: int):
    count = ds.count_account_transactions(get_conn(), account_id)
    return {"account_id": account_id, "count": count}


@router.put("/{account_id}", response_model=AccountOut)
def update_account(account_id: int, body: AccountUpdate):
    kwargs = body.model_dump(exclude_none=True)
    ds.update_account(get_live_conn(), account_id, **kwargs)
    row = ds.get_account(get_live_conn(), account_id)
    if not row:
        raise HTTPException(404, "Account not found")
    return _to_out(row)


@router.post("/{account_id}/archive")
def archive_account(account_id: int):
    ds.archive_account(get_live_conn(), account_id)
    return {"ok": True}


@router.post("/{account_id}/restore")
def restore_account(account_id: int):
    ds.restore_account(get_live_conn(), account_id)
    return {"ok": True}


@router.delete("/{account_id}")
def delete_account(account_id: int):
    txn_count = ds.count_account_transactions(get_live_conn(), account_id)
    if txn_count > 0:
        raise HTTPException(
            400,
            f"Cannot delete account: it has {txn_count} transaction(s). "
            "Remove or re-categorize them first, or archive the account instead.",
        )
    acc = ds.get_account(get_live_conn(), account_id)
    if not acc:
        raise HTTPException(404, "Account not found")
    ds.delete_account(get_live_conn(), account_id)
    return {"ok": True, "message": f"Account '{acc['name']}' deleted"}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_out(row: dict) -> AccountOut:
    return AccountOut(
        id=row["id"],
        name=row["name"],
        type=row["type"],
        parent_id=row.get("parent_id"),
        code=row.get("code"),
        description=row.get("description"),
        is_active=bool(row["is_active"]),
        currency=row.get("currency", "USD") or "USD",
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _bank_to_out(row: dict) -> BankAccountOut:
    return BankAccountOut(
        id=row["id"],
        bank_name=row["bank_name"],
        last_four=row.get("last_four", ""),
        full_number=row.get("full_number"),
        nickname=row.get("nickname"),
        ledger_account_id=row.get("ledger_account_id"),
        ledger_account_name=row.get("ledger_account_name"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )
