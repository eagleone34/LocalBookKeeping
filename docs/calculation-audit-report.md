# LedgerLocal Financial Calculation Audit Report

**Audit Date:** March 15, 2026
**Auditor:** Roo (Architect Mode)
**Scope:** All financial calculations in LedgerLocal application

## Executive Summary

**CRITICAL ISSUES FOUND: 3**
**MODERATE ISSUES FOUND: 2**
**MINOR ISSUES FOUND: 3**

The audit revealed fundamental calculation errors in net income and inconsistent handling of expense amounts throughout the codebase. These issues can lead to incorrect financial reporting and must be addressed immediately.

## Critical Issues

### 1. NET INCOME CALCULATION ERROR (CRITICAL)
**Location:** [`backend/app/routers/reports.py:82`](backend/app/routers/reports.py:82)
**Severity:** CRITICAL
**Impact:** All dashboard net income figures are incorrect

**Current (Incorrect) Code:**
```python
net_income=totals.get("income", 0) + totals.get("expense", 0),
```

**Problem:**
- Expenses are stored as negative numbers in the database
- Adding income + expense works mathematically (e.g., $54 + (-$551) = -$497)
- However, the `summary_totals()` function returns the actual signed values
- User reported: Income = $54, Expenses = $551, but Net Income shows $605
- This suggests expenses are being treated as positive somewhere in the chain

**Root Cause:**
Inconsistent expense handling between:
- `summary_totals()` - uses signed `t.amount` directly
- `monthly_trend()` - uses `ABS(t.amount)` for expenses
- Dashboard display - uses `abs(totals.get("expense", 0))` for display

**Corrected Code:**
```python
net_income=totals.get("income", 0) - abs(totals.get("expense", 0)),
```

**Files Affected:**
- [`backend/app/routers/reports.py`](backend/app/routers/reports.py:82)
- [`frontend/src/pages/Dashboard.jsx`](frontend/src/pages/Dashboard.jsx:39) - displays the incorrect value

---

### 2. INCONSISTENT EXPENSE AMOUNT HANDLING (CRITICAL)
**Location:** Multiple files
**Severity:** CRITICAL
**Impact:** Unpredictable calculation results across different reports

**Inconsistent Patterns Found:**

1. **Using ABS() - Treating expenses as positive:**
   ```python
   # data_service.py:694
   SUM(CASE WHEN a.type='expense' THEN ABS(t.amount) ELSE 0 END) AS expenses
   
   # data_service.py:607
   SUM(ABS(amount)) as actual_amount
   
   # data_service.py:639
   SUM(ABS(t.amount)) AS total
   ```

2. **Using signed values - Treating expenses as negative:**
   ```python
   # data_service.py:741
   SUM(CASE WHEN a.type='expense' THEN t.amount ELSE 0 END) AS total_expense
   
   # data_service.py:727
   SUM(t.amount) AS balance
   
   # data_service.py:763
   SUM(t.amount) AS total
   ```

**Problem:**
- Same database field (`t.amount`) is treated differently in different queries
- Expenses are stored as NEGATIVE (per pdf_parser.py:498)
- Some queries convert to positive with ABS(), others use signed values
- Results in inconsistent and unpredictable calculations

**Recommendation:**
Standardize on signed value convention (Option A from rules document):
- Store expenses as negative (already done correctly)
- Use `t.amount` directly in all SUM queries
- Apply ABS() ONLY for display purposes

**Files Affected:**
- [`backend/app/services/data_service.py`](backend/app/services/data_service.py) - multiple locations
- [`backend/app/routers/reports.py`](backend/app/routers/reports.py) - dashboard calculation
- [`frontend/src/pages/Reports.jsx`](frontend/src/pages/Reports.jsx) - display logic

---

### 3. BUDGET VS ACTUAL VARIANCE CALCULATION ERROR (CRITICAL)
**Location:** [`backend/app/services/data_service.py:615`](backend/app/services/data_service.py:615)
**Severity:** CRITICAL
**Impact:** Budget variance reports show incorrect values

**Current (Incorrect) Code:**
```python
SUM(b.amount) - COALESCE(SUM(t.actual_amount), 0) AS variance
```

**Problem:**
- `b.amount` (budget) is stored as POSITIVE
- `t.actual_amount` uses `ABS(amount)` (line 607), making it POSITIVE
- Variance calculation mixes both as positive numbers
- Should be: `budgeted - actual` for proper variance

**Example:**
- Budget: $1000 (positive)
- Actual expense: -$1200 (stored as negative, ABS makes it 1200)
- Current variance: $1000 - $1200 = -$200 (shows under budget)
- Should be: $1000 - $1200 = -$200 (correct, but for wrong reasons)

**The real issue:** If actual is under budget ($800), variance shows $1000 - $800 = $200 (over budget indicator), which is backwards for expenses.

**Corrected Code:**
```python
# For expense accounts, variance should be: budgeted - actual
# Where actual is the signed expense amount (negative)
SUM(b.amount) - COALESCE(SUM(t.signed_amount), 0) AS variance
```

**Files Affected:**
- [`backend/app/services/data_service.py:607-615`](backend/app/services/data_service.py:607-615)

---

## Moderate Issues

### 4. BALANCE SHEET DOES NOT VALIDATE ACCOUNTING EQUATION
**Location:** [`backend/app/services/data_service.py:716-756`](backend/app/services/data_service.py:716-756)
**Severity:** MODERATE
**Impact:** Balance sheet may not balance

**Current Implementation:**
- Calculates assets and liabilities from transactions
- Adds "Retained Earnings" as a manual calculation
- Does NOT validate: Assets = Liabilities + Equity

**Missing:**
- Equity account type in database schema
- Validation of accounting equation
- Proper equity calculation (Owner's Equity + Retained Earnings)

**Recommendation:**
Add equity accounts and validation:
```python
total_assets = sum(r["balance"] for r in rows if r["type"] == "asset")
total_liabilities = sum(r["balance"] for r in rows if r["type"] == "liability")
total_equity = sum(r["balance"] for r in rows if r["type"] == "equity")

# Validate
if abs(total_assets - (total_liabilities + total_equity)) > 0.01:
    raise ValueError("Balance sheet does not balance")
```

---

### 5. NO DECIMAL PRECISION CONTROL
**Location:** Database schema
**Severity:** MODERATE
**Impact:** Potential rounding errors in financial calculations

**Current:**
```sql
amount REAL NOT NULL
```

**Problem:**
- SQLite REAL is floating-point, not exact decimal
- Financial calculations require exact precision
- Rounding errors can accumulate over many transactions

**Recommendation:**
Store as INTEGER (cents) or use DECIMAL type if switching to PostgreSQL/MySQL

---

## Minor Issues

### 6. FRONTEND DISPLAY INCONSISTENCIES
**Location:** [`frontend/src/pages/Reports.jsx:93`](frontend/src/pages/Reports.jsx:93)
**Severity:** MINOR

```javascript
const totalLiabilities = liabilities.reduce((s, r) => s + Math.abs(r.balance), 0);
```

**Problem:**
- Uses `Math.abs()` for display, but backend sends signed values
- Inconsistent with how assets are handled
- Should be handled consistently at backend

---

### 7. MISSING DATA INTEGRITY CHECKS
**Location:** Various
**Severity:** MINOR

**Missing Checks:**
- No validation that income amounts are positive
- No validation that expense amounts are negative
- No checks for duplicate transactions beyond basic date/amount
- No reconciliation reports

---

### 8. INCONSISTENT NAMING CONVENTIONS
**Location:** Various
**Severity:** MINOR

**Examples:**
- `account_id` vs `category_id` (legacy vs new)
- `total_expense` vs `expenses` (different variable names)
- `net` vs `net_income` (inconsistent naming)

---

## Calculation Formulas Documentation

### Current Formulas (Mixed Correct/Incorrect)

#### Dashboard Summary
```python
# reports.py:80-85
total_income = totals.get("income", 0)                    # Signed positive
total_expenses = abs(totals.get("expense", 0))            # ABS for display
net_income = totals.get("income", 0) + totals.get("expense", 0)  # BUG: should be minus
total_assets = totals.get("asset", 0)                     # Signed
total_liabilities = abs(totals.get("liability", 0))       # ABS for display
net_worth = totals.get("asset", 0) + totals.get("liability", 0)  # Liability is negative
```

#### Monthly Trend
```python
# data_service.py:693-694, 711
income = SUM(CASE WHEN a.type='income' THEN t.amount ELSE 0 END)  # Signed positive
expenses = SUM(CASE WHEN a.type='expense' THEN ABS(t.amount) ELSE 0 END)  # ABS - INCONSISTENT
net = income - expenses  # Correct calculation
```

#### Profit & Loss
```python
# data_service.py:581
total = SUM(t.amount)  # Signed values, grouped by type
```

#### Budget vs Actual
```python
# data_service.py:607, 615
actual_amount = SUM(ABS(amount))  # Positive only
variance = SUM(b.amount) - COALESCE(SUM(t.actual_amount), 0)  # BUG: mixed signs
```

#### Balance Sheet
```python
# data_service.py:727-728, 740-741, 748
balance = SUM(t.amount)  # Signed values
total_income = SUM(CASE WHEN a.type='income' THEN t.amount ELSE 0 END)  # Signed
total_expense = SUM(CASE WHEN a.type='expense' THEN t.amount ELSE 0 END)  # Signed negative
retained = total_income + total_expense  # Correct: expense is negative
```

#### Expense by Category/Vendor
```python
# data_service.py:639, 666
total = SUM(ABS(t.amount))  # Always positive
```

### Corrected Formulas (Standardized)

#### Dashboard Summary (Fixed)
```python
total_income = totals.get("income", 0)                    # Signed positive
total_expenses = abs(totals.get("expense", 0))            # ABS for display
net_income = totals.get("income", 0) - abs(totals.get("expense", 0))  # FIXED: minus
total_assets = totals.get("asset", 0)                     # Signed
total_liabilities = abs(totals.get("liability", 0))       # ABS for display
net_worth = totals.get("asset", 0) + totals.get("liability", 0)  # Liability is negative
```

#### Monthly Trend (Fixed)
```python
income = SUM(CASE WHEN a.type='income' THEN t.amount ELSE 0 END)  # Signed positive
expenses = ABS(SUM(CASE WHEN a.type='expense' THEN t.amount ELSE 0 END))  # FIXED: signed sum then ABS
net = income - expenses  # Already correct
```

#### Budget vs Actual (Fixed)
```python
actual_amount = SUM(amount)  # Signed values
variance = SUM(b.amount) - ABS(COALESCE(SUM(t.actual_amount), 0))  # FIXED: consistent signs
```

---

## Testing Recommendations

### Unit Tests Needed

1. **Net Income Calculation**
   - Test: $100 income, -$50 expenses = $50 net income
   - Test: $50 income, -$100 expenses = -$50 net loss
   - Test: Zero income, zero expenses
   - Test: Large numbers, decimal values

2. **Expense Amount Handling**
   - Test: Expense transactions stored as negative
   - Test: All SUM queries return consistent signs
   - Test: ABS() only applied for display, not calculation

3. **Balance Sheet Validation**
   - Test: Assets = Liabilities + Equity
   - Test: Various account combinations
   - Test: Retained earnings calculation

4. **Budget Variance**
   - Test: Under budget (positive variance for expenses)
   - Test: Over budget (negative variance for expenses)
   - Test: Exact budget match

5. **Monthly Trends**
   - Test: Multiple months with varying income/expense
   - Test: Year boundary crossing
   - Test: Empty periods

### Integration Tests Needed

1. **End-to-End Transaction Flow**
   - Import PDF → Parse amounts → Store → Calculate reports → Display
   - Verify amounts maintain correct signs throughout

2. **Report Consistency**
   - Same period across different reports should match
   - Dashboard vs P&L vs Monthly Trend should align

3. **Data Integrity**
   - Import same transaction twice → detect duplicates
   - Edit transaction → recalculate all affected reports

---

## Fix Priority Order

### Priority 1: CRITICAL (Fix Immediately)
1. Fix dashboard net income calculation (reports.py:82)
2. Standardize expense amount handling across all queries
3. Fix budget vs actual variance calculation

### Priority 2: HIGH (Fix Within 1 Week)
4. Add balance sheet accounting equation validation
5. Add data integrity checks for amount signs
6. Create comprehensive unit tests

### Priority 3: MEDIUM (Fix Within 2 Weeks)
7. Improve decimal precision handling
8. Add reconciliation reports
9. Standardize naming conventions

### Priority 4: LOW (Future Enhancement)
10. Add equity account type
11. Create financial period closing process
12. Add audit trail for calculation results

---

## Files Requiring Changes

### Backend Files
- [`backend/app/routers/reports.py`](backend/app/routers/reports.py) - Line 82 (net income)
- [`backend/app/services/data_service.py`](backend/app/services/data_service.py) - Lines 607, 615, 639, 666, 694
- [`backend/app/database.py`](backend/app/database.py) - Add equity account type

### Frontend Files
- [`frontend/src/pages/Dashboard.jsx`](frontend/src/pages/Dashboard.jsx) - Verify display logic
- [`frontend/src/pages/Reports.jsx`](frontend/src/pages/Reports.jsx) - Lines 79, 93 (display logic)

### Test Files (New)
- [`backend/tests/test_calculations.py`](backend/tests/test_calculations.py) - New file needed
- [`backend/tests/test_data_integrity.py`](backend/tests/test_data_integrity.py) - New file needed

### Documentation
- [`docs/financial-accuracy-rules.md`](docs/financial-accuracy-rules.md) - Created
- [`docs/calculation-audit-report.md`](docs/calculation-audit-report.md) - This file

---

## Conclusion

The audit identified critical calculation errors that affect the core financial reporting functionality of LedgerLocal. The primary issues are:

1. **Net income calculation error** causing incorrect profit/loss reporting
2. **Inconsistent expense amount handling** leading to unpredictable results
3. **Budget variance calculation error** affecting budget vs actual analysis

These issues stem from inconsistent handling of expense amount signs (positive vs negative) across different parts of the codebase. The recommended solution is to standardize on the double-entry accounting convention where expenses are stored as negative numbers and use consistent calculation methods throughout.

**Immediate Action Required:** Fix the three critical issues identified in Priority 1 to ensure financial accuracy.

**Estimated Fix Time:** 2-3 days for critical issues, 1-2 weeks for complete resolution including tests.

**Risk Level:** HIGH - Current calculations may produce incorrect financial reports, affecting business decisions.
