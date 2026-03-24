"""
Budgets API endpoints.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException

from app.models import BudgetUpsert, BudgetOut, BudgetSummaryRow
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


# ---------------------------------------------------------------------------
# GET /api/budgets/summary
# ---------------------------------------------------------------------------

@router.get("/summary", response_model=List[BudgetSummaryRow])
def budget_summary(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    account_id: Optional[int] = None,
):
    """Return per-expense-category User Budget / Actual / Variance rows.

    - **user_budget**: the most-recent monthly budget amount the user has set
      for each category.  NOT filtered by date range — always shows the
      standing target regardless of which period is selected.
    - **actual**: monthly-normalised spend in the requested period.
      Formula: ``total_spend_in_period / num_calendar_months_in_period``
    - **variance**: ``user_budget − actual``  (positive = under budget)

    Query parameters:
    - ``start_date`` / ``end_date`` — ISO-8601 date strings (``YYYY-MM-DD``).
      When omitted, *actual* is calculated over all time and num_months defaults
      to 1 (so full totals are shown).
    - ``account_id`` — optional filter to a single expense category.
    """
    rows = ds.budget_summary_by_period(
        get_conn(),
        get_company_id(),
        start_date=start_date,
        end_date=end_date,
        account_id=account_id,
    )
    return [
        BudgetSummaryRow(
            account_id=r["account_id"],
            account_name=r["account_name"],
            user_budget=round(float(r["user_budget"]), 2),
            actual=round(float(r["actual"]), 2),
            variance=round(float(r["variance"]), 2),
        )
        for r in rows
    ]


# ---------------------------------------------------------------------------
# GET /api/budgets  (list raw budget records)
# ---------------------------------------------------------------------------

@router.get("", response_model=List[BudgetOut])
def list_budgets(month: Optional[str] = None):
    rows = ds.list_budgets(get_conn(), get_company_id(), month=month)
    return [_to_out(r) for r in rows]


# ---------------------------------------------------------------------------
# POST /api/budgets  (upsert)
# ---------------------------------------------------------------------------

@router.post("", response_model=dict, status_code=201)
def upsert_budget(body: BudgetUpsert):
    # Default to current month if not provided
    month = body.month or _get_current_month()

    # Reject modifications to historical months
    if _is_historical_month(month):
        raise HTTPException(
            status_code=400,
            detail="Cannot modify historical budget records",
        )

    bid = ds.upsert_budget(
        get_conn(), get_company_id(),
        body.account_id, month, body.amount, body.notes or "",
    )
    return {"id": bid, "ok": True}


# ---------------------------------------------------------------------------
# DELETE /api/budgets/{budget_id}
# ---------------------------------------------------------------------------

@router.delete("/{budget_id}")
def delete_budget(budget_id: int):
    # Check if the budget being deleted is historical
    conn = get_conn()
    budget = conn.execute(
        "SELECT month FROM budgets WHERE id=?", (budget_id,)
    ).fetchone()

    if budget and _is_historical_month(budget["month"]):
        raise HTTPException(
            status_code=400,
            detail="Cannot modify historical budget records",
        )

    ds.delete_budget(conn, budget_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

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
