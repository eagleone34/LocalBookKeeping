"""
Accounts API endpoints.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException

from app.models import AccountCreate, AccountOut, AccountUpdate
from app.main_state import get_conn, get_company_id
from app.services import data_service as ds

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


@router.get("", response_model=List[AccountOut])
def list_accounts(include_inactive: bool = False):
    rows = ds.list_accounts(get_conn(), get_company_id(), include_inactive)
    return [_to_out(r) for r in rows]


@router.post("", response_model=AccountOut, status_code=201)
def create_account(body: AccountCreate):
    aid = ds.create_account(
        get_conn(), get_company_id(), body.name, body.type,
        body.parent_id, body.code, body.description,
    )
    row = ds.get_account(get_conn(), aid)
    return _to_out(row)


@router.put("/{account_id}", response_model=AccountOut)
def update_account(account_id: int, body: AccountUpdate):
    kwargs = body.model_dump(exclude_none=True)
    if "type" in kwargs:
        # Rename to avoid SQL conflict
        pass
    ds.update_account(get_conn(), account_id, **kwargs)
    row = ds.get_account(get_conn(), account_id)
    if not row:
        raise HTTPException(404, "Account not found")
    return _to_out(row)


@router.post("/{account_id}/archive")
def archive_account(account_id: int):
    ds.archive_account(get_conn(), account_id)
    return {"ok": True}


@router.post("/{account_id}/restore")
def restore_account(account_id: int):
    ds.restore_account(get_conn(), account_id)
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
