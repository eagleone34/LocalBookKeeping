"""
Budgets API endpoints.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter

from app.models import BudgetUpsert, BudgetOut
from app.main_state import get_conn, get_company_id
from app.services import data_service as ds

router = APIRouter(prefix="/api/budgets", tags=["budgets"])


@router.get("", response_model=List[BudgetOut])
def list_budgets(month: Optional[str] = None):
    rows = ds.list_budgets(get_conn(), get_company_id(), month=month)
    return [_to_out(r) for r in rows]


@router.post("", response_model=dict, status_code=201)
def upsert_budget(body: BudgetUpsert):
    bid = ds.upsert_budget(
        get_conn(), get_company_id(),
        body.account_id, body.month, body.amount, body.notes or "",
    )
    return {"id": bid, "ok": True}


@router.delete("/{budget_id}")
def delete_budget(budget_id: int):
    ds.delete_budget(get_conn(), budget_id)
    return {"ok": True}


def _to_out(row: dict) -> BudgetOut:
    return BudgetOut(
        id=row["id"],
        account_id=row["account_id"],
        account_name=row.get("account_name", ""),
        account_type=row.get("account_type", ""),
        month=row["month"],
        amount=row["amount"],
        notes=row.get("notes"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )
