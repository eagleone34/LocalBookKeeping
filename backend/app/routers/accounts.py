"""
Accounts API endpoints.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException

from app.models import AccountCreate, AccountOut, AccountUpdate, BankAccountCreate, BankAccountOut
from app.main_state import get_conn, get_live_conn, get_company_id
from app.services import data_service as ds

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


@router.get("", response_model=List[AccountOut])
def list_accounts(include_inactive: bool = False):
    rows = ds.list_accounts(get_conn(), get_company_id(), include_inactive)
    return [_to_out(r) for r in rows]


@router.post("", response_model=AccountOut, status_code=201)
def create_account(body: AccountCreate):
    aid = ds.create_account(
        get_live_conn(), get_company_id(), body.name, body.type,
        body.parent_id, body.code, body.description,
    )
    row = ds.get_account(get_live_conn(), aid)
    return _to_out(row)


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
    """Delete account only if it has zero transactions."""
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


@router.get("/{account_id}/transaction-count")
def account_transaction_count(account_id: int):
    """Return how many transactions reference this account."""
    count = ds.count_account_transactions(get_conn(), account_id)
    return {"account_id": account_id, "count": count}


# ═══════════════════════════════════════════════════════
#  BANK ACCOUNTS (Account ↔ COA linking)
# ═══════════════════════════════════════════════════════

@router.get("/bank-accounts", response_model=List[BankAccountOut])
def list_bank_accounts():
    """Return all bank accounts with their linked COA account info."""
    rows = ds.list_bank_accounts(get_conn(), get_company_id())
    return [_bank_to_out(r) for r in rows]


@router.post("/bank-accounts", response_model=BankAccountOut, status_code=201)
def create_bank_account(body: BankAccountCreate):
    """
    Create a bank account AND automatically create a corresponding COA account
    if one doesn't already exist.

    - checking/savings → asset COA account
    - credit_card → liability COA account
    """
    conn = get_live_conn()
    company_id = get_company_id()

    # Determine COA account type based on bank account type
    if body.account_type == "credit_card":
        coa_type = "liability"
        label = "Credit Card"
    elif body.account_type == "savings":
        coa_type = "asset"
        label = "Savings"
    else:
        coa_type = "asset"
        label = "Checking"

    # Build a descriptive COA account name: "Chase Checking ****1234"
    masked = f"****{body.last_four}" if body.last_four else ""
    coa_name = f"{body.bank_name} {label} {masked}".strip()

    # Check if a COA account with this name already exists
    existing_coa = conn.execute(
        "SELECT id FROM accounts WHERE company_id=? AND name=? AND type=?",
        (company_id, coa_name, coa_type),
    ).fetchone()

    if existing_coa:
        ledger_account_id = int(existing_coa["id"])
    else:
        # Create the COA account
        ledger_account_id = ds.create_account(
            conn, company_id, coa_name, coa_type,
            description=f"Auto-created for {body.bank_name} {body.last_four}",
        )

    # Create (or find) the bank account, linked to the COA account
    bank_id = ds.upsert_bank_account(
        conn, company_id,
        bank_name=body.bank_name,
        last_four=body.last_four,
        full_number=body.full_number or "",
        nickname=body.nickname or "",
        ledger_account_id=ledger_account_id,
    )

    # If the bank account already existed but had no ledger link, update it
    ba = ds.get_bank_account(conn, bank_id)
    if ba and not ba.get("ledger_account_id"):
        ds.update_bank_account(conn, bank_id, ledger_account_id=ledger_account_id)
        ba = ds.get_bank_account(conn, bank_id)

    # Return full bank account info with ledger account name
    row = ds.find_bank_account_by_last_four(conn, company_id, body.bank_name, body.last_four)
    if not row:
        raise HTTPException(500, "Bank account created but not found")
    return _bank_to_out(row)


@router.put("/bank-accounts/{bank_account_id}")
def update_bank_account(bank_account_id: int, body: dict):
    """Update bank account fields (e.g., link a ledger account)."""
    ds.update_bank_account(get_live_conn(), bank_account_id, **body)
    return {"ok": True}


def _to_out(row: dict) -> AccountOut:
    return AccountOut(
        id=row["id"],
        name=row["name"],
        type=row["type"],
        parent_id=row.get("parent_id"),
        code=row.get("code"),
        description=row.get("description"),
        is_active=bool(row["is_active"]),
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
