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
    conversion_rates: Optional[str] = None
    created_at: str
    updated_at: str


class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    currency: Optional[str] = None
    fiscal_year_start: Optional[int] = None
    conversion_rates: Optional[str] = None


# ── Accounts ─────────────────────────────────────────
class AccountCreate(BaseModel):
    name: str
    type: str = Field(..., pattern="^(income|expense|asset|liability|equity)$")
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
    account_id: Optional[int] = None
    category_id: Optional[int] = None
    vendor_name: Optional[str] = None
    txn_date: str
    description: Optional[str] = None
    memo: Optional[str] = None
    amount: float
    source: str = "manual"
    bank_account_id: Optional[int] = None


class TransactionUpdate(BaseModel):
    account_id: Optional[int] = None
    category_id: Optional[int] = None
    vendor_name: Optional[str] = None
    txn_date: Optional[str] = None
    description: Optional[str] = None
    memo: Optional[str] = None
    amount: Optional[float] = None
    bank_account_id: Optional[int] = None


class TransactionOut(BaseModel):
    id: int
    account_id: int
    account_name: str = ""
    account_type: str = ""
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    category_type: Optional[str] = None
    vendor_id: Optional[int]
    vendor_name: Optional[str]
    txn_date: str
    description: Optional[str]
    memo: Optional[str]
    amount: float
    is_posted: bool
    source: str
    source_doc_id: Optional[int] = None
    bank_account_id: Optional[int] = None
    bank_account_name: Optional[str] = None
    is_reconciled: bool = False
    reconciliation_id: Optional[int] = None
    created_at: str
    updated_at: str


class BulkRecategorize(BaseModel):
    transaction_ids: List[int]
    category_id: int


# ── Ledger (Account drill-down with running balance) ──
class LedgerRow(BaseModel):
    id: int
    txn_date: str
    vendor_name: Optional[str]
    description: Optional[str]
    amount: float
    running_balance: float
    is_reconciled: bool = False
    reconciliation_id: Optional[int] = None
    source: str = "manual"
    bank_account_id: Optional[int] = None


class AccountBalanceOut(BaseModel):
    account_id: int
    account_name: str
    account_type: str
    balance: float
    bank_account_id: Optional[int] = None
    bank_name: Optional[str] = None
    last_four: Optional[str] = None
    last_reconciled_date: Optional[str] = None
    last_reconciled_balance: Optional[float] = None


# ── Budgets ──────────────────────────────────────────
class BudgetUpsert(BaseModel):
    account_id: int
    month: Optional[str] = None
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


class BudgetSummaryRow(BaseModel):
    account_id: int
    account_name: str
    user_budget: float = 0.0
    actual: float = 0.0
    variance: float = 0.0


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
    bank_name: Optional[str] = None
    account_last_four: Optional[str] = None

class MappedTransactionIn(BaseModel):
    txn_date: str
    description: str
    amount: float
    vendor_name: Optional[str] = ""

class BulkImportRequest(BaseModel):
    filename: str
    bank_account_id: Optional[int] = None
    category_id: Optional[int] = None
    ledger_account_id: Optional[int] = None
    bank_name: Optional[str] = None
    account_last_four: Optional[str] = None
    transactions: List[MappedTransactionIn]


class DocTransactionOut(BaseModel):
    id: int
    document_id: int
    txn_date: Optional[str]
    description: Optional[str]
    amount: Optional[float]
    vendor_name: Optional[str]
    suggested_account_id: Optional[int] = None
    suggested_account_name: Optional[str] = None
    suggested_category_id: Optional[int] = None
    suggested_category_name: Optional[str] = None
    confidence: float
    status: str
    user_account_id: Optional[int] = None
    user_account_name: Optional[str] = None
    user_category_id: Optional[int] = None
    user_category_name: Optional[str] = None
    is_duplicate: bool = False
    duplicate_of_txn_id: Optional[int] = None
    bank_account_id: Optional[int] = None
    bank_account_name: Optional[str] = None


class DocTransactionAction(BaseModel):
    action: str = Field(..., pattern="^(approve|reject|revert)$")
    account_id: Optional[int] = None
    category_id: Optional[int] = None


class BulkDocTransactionAction(BaseModel):
    ids: List[int]
    action: str = Field(..., pattern="^(approve|reject|revert)$")
    account_id: Optional[int] = None
    category_id: Optional[int] = None


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
    month: Optional[str] = None
    account_id: int
    account_name: str
    account_type: str
    budgeted: float
    actual: float
    variance: float
    budget_month_count: int = 1
    monthly_budget: float = 0.0
    monthly_actual: float = 0.0
    actual_month_count: int = 0


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


# ── Bank Accounts ────────────────────────────────────
class BankAccountCreate(BaseModel):
    bank_name: str
    last_four: str
    account_type: str = Field("checking", pattern="^(checking|savings|credit_card)$")
    nickname: Optional[str] = None
    full_number: Optional[str] = None


class BankAccountOut(BaseModel):
    id: int
    bank_name: str
    last_four: str
    full_number: Optional[str] = None
    nickname: Optional[str] = None
    ledger_account_id: Optional[int] = None
    ledger_account_name: Optional[str] = None
    created_at: str
    updated_at: str


# ── Reconciliation ───────────────────────────────────
class ReconciliationCreate(BaseModel):
    statement_date: str          # YYYY-MM-DD
    statement_balance: float
    notes: Optional[str] = None
    transaction_ids: List[int] = []   # IDs of transactions to mark as reconciled


class ReconciliationOut(BaseModel):
    id: int
    company_id: int
    bank_account_id: int
    reconciled_date: str
    statement_balance: float
    localbooks_balance: float
    difference: float
    status: str
    notes: Optional[str]
    created_at: str


class ReconciliationStatusOut(BaseModel):
    bank_account_id: int
    bank_name: str
    last_four: str
    last_reconciled_date: Optional[str]
    last_reconciled_balance: Optional[float]
    localbooks_balance_today: float
    unreconciled_count: int
    unreconciled_transactions: List[LedgerRow]


# ── Category Suggestion ──────────────────────────────
class SuggestCategoryTransaction(BaseModel):
    description: str
    amount: float
    date: str


class SuggestCategoriesRequest(BaseModel):
    transactions: List[SuggestCategoryTransaction]
    bank_account_id: Optional[int] = None


class CategorySuggestionGroup(BaseModel):
    group_key: str
    sample_description: str
    transaction_indices: List[int]
    suggested_category_id: Optional[int] = None
    suggested_category_name: Optional[str] = None
    confidence: float = 0.0  # 0.0 to 1.0 scale (frontend multiplies by 100 for display)
    match_reason: str = ""
    transaction_type: str = ""  # "Withdrawal" or "Deposit"


class SuggestCategoriesResponse(BaseModel):
    groups: List[CategorySuggestionGroup]
    ungrouped_indices: List[int]
