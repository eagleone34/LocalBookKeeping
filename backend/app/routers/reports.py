"""
Reports API endpoints.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter

from app.models import (
    PnLRow, BudgetVsActualRow, CategoryBreakdownRow,
    VendorBreakdownRow, MonthlyTrendRow, BalanceSheetRow, DashboardSummary,
    TransactionOut,
)
from app.main_state import get_conn, get_company_id
from app.services import data_service as ds

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/pnl", response_model=List[PnLRow])
def profit_and_loss(date_from: Optional[str] = None, date_to: Optional[str] = None):
    rows = ds.profit_and_loss(get_conn(), get_company_id(), date_from, date_to)
    return [PnLRow(type=r["type"], month=r["month"], total=r["total"]) for r in rows]


@router.get("/budget-vs-actual", response_model=List[BudgetVsActualRow])
def budget_vs_actual(month_from: Optional[str] = None, month_to: Optional[str] = None, account_id: Optional[int] = None):
    rows = ds.budget_vs_actual(get_conn(), get_company_id(), month_from, month_to, account_id)
    return [BudgetVsActualRow(
        account_id=r["account_id"], account_name=r["account_name"],
        account_type=r["account_type"], budgeted=r["budgeted"], actual=r["actual"],
        variance=r["variance"],
    ) for r in rows]


@router.get("/expense-by-category", response_model=List[CategoryBreakdownRow])
def expense_by_category(date_from: Optional[str] = None, date_to: Optional[str] = None):
    rows = ds.expense_by_category(get_conn(), get_company_id(), date_from, date_to)
    return [CategoryBreakdownRow(
        account_id=r["account_id"], account_name=r["account_name"],
        total=r["total"], percentage=r["percentage"],
    ) for r in rows]


@router.get("/expense-by-vendor", response_model=List[VendorBreakdownRow])
def expense_by_vendor(date_from: Optional[str] = None, date_to: Optional[str] = None):
    rows = ds.expense_by_vendor(get_conn(), get_company_id(), date_from, date_to)
    return [VendorBreakdownRow(
        vendor_name=r["vendor_name"], total=r["total"], percentage=r["percentage"],
    ) for r in rows]


@router.get("/monthly-trend", response_model=List[MonthlyTrendRow])
def monthly_trend(months: int = 12):
    rows = ds.monthly_trend(get_conn(), get_company_id(), months)
    return [MonthlyTrendRow(month=r["month"], income=r["income"], expenses=r["expenses"], net=r["net"]) for r in rows]


@router.get("/balance-sheet", response_model=List[BalanceSheetRow])
def balance_sheet():
    rows = ds.balance_sheet(get_conn(), get_company_id())
    return [BalanceSheetRow(type=r["type"], account_name=r["account_name"], balance=r["balance"]) for r in rows]


@router.get("/dashboard", response_model=DashboardSummary)
def dashboard(date_from: Optional[str] = None, date_to: Optional[str] = None):
    conn = get_conn()
    cid = get_company_id()

    totals = ds.summary_totals(conn, cid, date_from, date_to)
    accounts = ds.list_accounts(conn, cid)
    txn_count = ds.count_transactions(conn, cid)
    pending = ds.count_pending_review(conn, cid)
    categories = ds.expense_by_category(conn, cid, date_from, date_to)
    trend = ds.monthly_trend(conn, cid, 12)
    recent_txns = ds.list_transactions(conn, cid, limit=10, date_from=date_from, date_to=date_to)

    return DashboardSummary(
        total_income=totals.get("income", 0),
        total_expenses=abs(totals.get("expense", 0)),
        net_income=totals.get("income", 0) + totals.get("expense", 0),
        total_assets=totals.get("asset", 0),
        total_liabilities=abs(totals.get("liability", 0)),
        net_worth=totals.get("asset", 0) + totals.get("liability", 0),
        account_count=len(accounts),
        transaction_count=txn_count,
        pending_review_count=pending,
        top_expense_categories=[
            CategoryBreakdownRow(account_id=r["account_id"], account_name=r["account_name"],
                                 total=r["total"], percentage=r["percentage"])
            for r in categories[:8]
        ],
        monthly_trend=[
            MonthlyTrendRow(month=r["month"], income=r["income"], expenses=r["expenses"], net=r["net"])
            for r in trend
        ],
        recent_transactions=[
            TransactionOut(
                id=r["id"], account_id=r["account_id"],
                account_name=r.get("account_name", ""), account_type=r.get("account_type", ""),
                vendor_id=r.get("vendor_id"), vendor_name=r.get("vendor_name"),
                txn_date=r["txn_date"], description=r.get("description"),
                memo=r.get("memo"), amount=r["amount"],
                is_posted=bool(r.get("is_posted", True)), source=r.get("source", "manual"),
                source_doc_id=r.get("source_doc_id"),
                created_at=r["created_at"], updated_at=r["updated_at"],
            )
            for r in recent_txns
        ],
    )

