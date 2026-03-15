"""
Budgets API endpoints.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException

from app.models import BudgetUpsert, BudgetOut
from app.main_state import get_conn, get_company_id
from app.services import data_service as ds

router = APIRouter(prefix="/api/budgets", tags=["budgets"])


def _get_current_month() -> str:
    """Get current month in YYYY-MM format."""
    return datetime.now().strftime("%Y-%m")


def _is_historical_month(month: str) -> bool:
    """Check if a given month is before the current month."""
    current = _get_current_month()
    return month < current


@router.get("", response_model=List[BudgetOut])
def list_budgets(month: Optional[str] = None):
    rows = ds.list_budgets(get_conn(), get_company_id(), month=month)
    return [_to_out(r) for r in rows]


@router.post("", response_model=dict, status_code=201)
def upsert_budget(body: BudgetUpsert):
    # Default to current month if not provided
    month = body.month or _get_current_month()
    
    # Reject modifications to historical months
    if _is_historical_month(month):
        raise HTTPException(
            status_code=400,
            detail="Cannot modify historical budget records"
        )
    
    bid = ds.upsert_budget(
        get_conn(), get_company_id(),
        body.account_id, month, body.amount, body.notes or "",
    )
    return {"id": bid, "ok": True}


@router.delete("/{budget_id}")
def delete_budget(budget_id: int):
    # Check if the budget being deleted is historical
    conn = get_conn()
    budget = conn.execute("SELECT month FROM budgets WHERE id=?", (budget_id,)).fetchone()
    
    if budget and _is_historical_month(budget["month"]):
        raise HTTPException(
            status_code=400,
            detail="Cannot modify historical budget records"
        )
    
    ds.delete_budget(conn, budget_id)
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
