"""
Pydantic models for API request/response shapes.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, Field


# ── Company ──────────────────────────────────────────
class CompanyOut(BaseModel):
    id: int
    name: str
    currency: str
    fiscal_year_start: int
    created_at: str
    updated_at: str


class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    currency: Optional[str] = None
    fiscal_year_start: Optional[int] = None


# ── Accounts ─────────────────────────────────────────
class AccountCreate(BaseModel):
    name: str
    type: str = Field(..., pattern="^(income|expense|asset|liability)$")
    parent_id: Optional[int] = None
    code: Optional[str] = None
    description: Optional[str] = None


class AccountUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    parent_id: Optional[int] = None
    code: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


class AccountOut(BaseModel):
    id: int
    name: str
    type: str
    parent_id: Optional[int]
    code: Optional[str]
    description: Optional[str]
    is_active: bool
    created_at: str
    updated_at: str
    children: List[AccountOut] = []


# ── Vendors ──────────────────────────────────────────
class VendorOut(BaseModel):
    id: int
    name: str


# ── Transactions ─────────────────────────────────────
class TransactionCreate(BaseModel):
    account_id: int
    vendor_name: Optional[str] = None
    txn_date: str
    description: Optional[str] = None
    memo: Optional[str] = None
    amount: float
    source: str = "manual"


class TransactionUpdate(BaseModel):
    account_id: Optional[int] = None
    vendor_name: Optional[str] = None
    txn_date: Optional[str] = None
    description: Optional[str] = None
    memo: Optional[str] = None
    amount: Optional[float] = None


class TransactionOut(BaseModel):
    id: int
    account_id: int
    account_name: str = ""
    account_type: str = ""
    vendor_id: Optional[int]
    vendor_name: Optional[str]
    txn_date: str
    description: Optional[str]
    memo: Optional[str]
    amount: float
    is_posted: bool
    source: str
    source_doc_id: Optional[int]
    created_at: str
    updated_at: str


class BulkRecategorize(BaseModel):
    transaction_ids: List[int]
    account_id: int


# ── Budgets ──────────────────────────────────────────
class BudgetUpsert(BaseModel):
    account_id: int
    month: str  # "YYYY-MM"
    amount: float
    notes: Optional[str] = None


class BudgetOut(BaseModel):
    id: int
    account_id: int
    account_name: str = ""
    account_type: str = ""
    month: str
    amount: float
    notes: Optional[str]
    created_at: str
    updated_at: str


# ── Documents ────────────────────────────────────────
class DocumentOut(BaseModel):
    id: int
    filename: str
    file_path: str
    file_size: Optional[int]
    page_count: Optional[int]
    status: str
    error_msg: Optional[str]
    imported_at: str
    processed_at: Optional[str]


class DocTransactionOut(BaseModel):
    id: int
    document_id: int
    txn_date: Optional[str]
    description: Optional[str]
    amount: Optional[float]
    vendor_name: Optional[str]
    suggested_account_id: Optional[int]
    suggested_account_name: Optional[str] = None
    confidence: float
    status: str
    user_account_id: Optional[int]
    user_account_name: Optional[str] = None


class DocTransactionAction(BaseModel):
    action: str = Field(..., pattern="^(approve|reject)$")
    account_id: Optional[int] = None  # override the suggested account


class BulkDocTransactionAction(BaseModel):
    ids: List[int]
    action: str = Field(..., pattern="^(approve|reject)$")
    account_id: Optional[int] = None


# ── Categorization Rules ─────────────────────────────
class RuleCreate(BaseModel):
    pattern: str
    match_type: str = "contains"
    account_id: int
    priority: int = 10


class RuleOut(BaseModel):
    id: int
    pattern: str
    match_type: str
    account_id: int
    account_name: str = ""
    priority: int
    is_active: bool


# ── Reports ──────────────────────────────────────────
class PnLRow(BaseModel):
    type: str
    month: str
    total: float


class BudgetVsActualRow(BaseModel):
    month: str
    account_id: int
    account_name: str
    account_type: str
    budgeted: float
    actual: float
    variance: float


class CategoryBreakdownRow(BaseModel):
    account_id: int
    account_name: str
    total: float
    percentage: float


class VendorBreakdownRow(BaseModel):
    vendor_name: str
    total: float
    percentage: float


class MonthlyTrendRow(BaseModel):
    month: str
    income: float
    expenses: float
    net: float


class BalanceSheetRow(BaseModel):
    type: str
    account_name: str
    balance: float


# ── Dashboard ────────────────────────────────────────
class DashboardSummary(BaseModel):
    total_income: float
    total_expenses: float
    net_income: float
    total_assets: float
    total_liabilities: float
    net_worth: float
    account_count: int
    transaction_count: int
    pending_review_count: int
    top_expense_categories: List[CategoryBreakdownRow]
    monthly_trend: List[MonthlyTrendRow]
    recent_transactions: List[TransactionOut]
