# Financial Accuracy Rules - LedgerLocal

## Critical Calculation Rules

### 1. Net Income Calculation
**RULE:** Net Income MUST be calculated as: `SUM(income) - SUM(expenses)`

**Current Issue:** Inconsistent calculation methods across the codebase
- Correct: `income - expenses` (used in monthly_trend)
- Incorrect: `income + expense` (used in dashboard)

**Storage Convention:**
- Income amounts: Stored as POSITIVE numbers
- Expense amounts: Stored as NEGATIVE numbers (debits)
- Asset/Liability amounts: Stored as signed values based on transaction direction

**Corrected Formulas:**
```python
# Dashboard Net Income (reports.py:82)
net_income = totals.get("income", 0) - abs(totals.get("expense", 0))

# Monthly Trend Net (data_service.py:711)
net = income - expenses  # Already correct

# Balance Sheet Retained Earnings (data_service.py:748)
retained = total_income + total_expense  # Correct: expense is negative
```

### 2. Expense Amount Handling
**RULE:** All expense calculations must consistently use either:
- Option A: Store expenses as negative, use `t.amount` directly in SUM queries
- Option B: Store expenses as positive, use `ABS(t.amount)` in all SUM queries

**Current Issue:** Inconsistent usage
- `monthly_trend`: Uses `ABS(t.amount)` for expenses (line 694)
- `summary_totals`: Uses `t.amount` directly (line 763)
- `balance_sheet`: Uses `t.amount` directly (line 727, 740-741)

**RECOMMENDATION:** Use Option A (negative storage) for proper double-entry accounting

### 3. Balance Sheet Validation
**RULE:** Balance sheet MUST satisfy: `Assets = Liabilities + Equity`

**Current Implementation Issues:**
- Retained Earnings is manually calculated and added as an asset
- No validation that the accounting equation balances
- Liability amounts use `ABS()` in frontend display but not in calculations

**Corrected Approach:**
```python
# Calculate Equity separately
# Equity = Owner's Equity + Retained Earnings
# Validate: total_assets == total_liabilities + total_equity
```

### 4. Data Type Precision
**RULE:** All financial amounts must be stored with minimum 4 decimal precision

**Current:** Using SQLite REAL type (approximate)
**Recommendation:** Store as INTEGER representing cents or use DECIMAL type

### 5. Query Consistency
**RULE:** All financial SUM queries must use consistent amount handling

**Required Pattern:**
```python
# For income accounts
SUM(CASE WHEN a.type='income' THEN t.amount ELSE 0 END)

# For expense accounts (stored as negative)
SUM(CASE WHEN a.type='expense' THEN t.amount ELSE 0 END)

# For display purposes only
ABS(SUM(CASE WHEN a.type='expense' THEN t.amount ELSE 0 END))
```

### 6. Frontend Display vs Backend Calculation
**RULE:** Frontend must display absolute values for expenses; backend must calculate with signed values

**Current Issues:**
- Dashboard shows `total_expenses=abs(totals.get("expense", 0))` ✓ Correct
- Reports shows `Math.abs(r.balance)` for liabilities ✓ Correct
- But calculations use signed values inconsistently

### 7. Budget vs Actual Variance
**RULE:** Variance must be calculated as: `Budgeted - Actual`

**Current Implementation:**
```python
# data_service.py:615
SUM(b.amount) - COALESCE(SUM(t.actual_amount), 0) AS variance
```
**Issue:** `actual_amount` uses `ABS(amount)` (line 607), but budget amounts are positive
**Result:** Variance calculation mixes positive budgets with absolute actuals

### 8. Transaction Amount Sign Convention
**RULE:** All transaction amounts must follow double-entry accounting:
- Debits: Negative values
- Credits: Positive values

**Current Implementation:** ✓ Correct in pdf_parser.py
- Debits: `amount = -abs(debit_val)` (line 498)
- Credits: `amount = abs(credit_val)` (line 503)

### 9. Testing Requirements
**RULE:** All financial calculations must have unit tests

**Required Test Cases:**
- Net income with positive income, negative expenses
- Net income with negative income (losses)
- Balance sheet with various asset/liability combinations
- Budget variance with over/under budget scenarios
- Monthly trends across year boundaries

### 10. Audit Trail
**RULE:** All financial data modifications must be logged

**Current:** Basic audit log exists
**Enhancement:** Log calculation results for reconciliation

## Implementation Checklist

- [ ] Standardize expense amount handling (choose negative storage convention)
- [ ] Fix dashboard net income calculation
- [ ] Add balance sheet validation
- [ ] Fix budget vs actual variance calculation
- [ ] Add unit tests for all calculations
- [ ] Add data integrity checks
- [ ] Document all calculation formulas in code comments
- [ ] Create reconciliation reports

## Enforcement

### Code Review Checklist
- [ ] All financial calculations have unit tests
- [ ] Net income validated: income - abs(expenses)
- [ ] Balance sheet validated: assets = liabilities + equity
- [ ] Expense amounts stored as negative values
- [ ] No use of ABS() inside SUM() calculations (only for final display)
- [ ] Budget variance correctly calculated: budgeted - abs(actual)

### Pre-commit Hooks
```bash
# Run calculation validation tests
cd backend && pytest tests/test_calculations.py -v

# Check for hardcoded numbers in calculations
grep -r "SUM(ABS" backend/app/services/ || echo "No problematic SUM(ABS) patterns found"

# Verify no new calculation logic without tests
grep -r "def.*calculation\|net_income\|balance_sheet" backend/app/ --include="*.py" | grep -v test | grep -v validation_service
```

### Automated Validation
The validation service (`backend/app/services/validation_service.py`) provides:
- `validate_net_income()` - Ensures net income = income - abs(expenses)
- `validate_balance_sheet()` - Ensures assets = liabilities + equity
- `get_calculation_errors()` - Returns all calculation errors for a report

### Critical Fixes Applied (March 2025)
1. **Net Income Calculation** (reports.py:82): Fixed from `income + expense` to `income - abs(expense)`
2. **Budget Actuals** (data_service.py:607): Fixed from `SUM(ABS(amount))` to `ABS(SUM(amount))`
3. **Expense by Category** (data_service.py:639): Fixed from `SUM(ABS(amount))` to `ABS(SUM(amount))`
4. **Expense by Vendor** (data_service.py:666): Fixed from `SUM(ABS(amount))` to `ABS(SUM(amount))`
5. **Monthly Trend** (data_service.py:694): Fixed from `SUM(ABS(amount))` to `ABS(SUM(amount))`
6. **Balance Sheet Net Income** (data_service.py): Fixed Retained Earnings to be classified as `equity` instead of `asset` to ensure the accounting equation (Assets = Liabilities + Equity) balances correctly.
7. **Transaction Amount Bug** (data_service.py): Fixed a critical bug in `create_transaction` where the `amount` was hardcoded to `1` and `is_posted` was set to the actual amount due to a parameter mismatch in the SQL query.

### 11. Demo Data Scale
**RULE:** Demo data must use realistic, large numbers to properly demonstrate the app's capabilities and ensure UI components (like charts and tables) can handle typical business volumes.
- Revenue should be in the tens or hundreds of thousands.
- Expenses should be proportionally realistic.

## Database Safety Rules

### Two Database Locations
| Database | Path | Purpose |
|----------|------|---------|
| **Dev DB** | `backend/company_data/ledgerlocal.db` | Used by the dev server (`uvicorn --reload`) |
| **Installed App DB** | `Documents\LocalBooks\company_data\ledgerlocal.db` | Used by the installed `.exe` app |

These are **separate files**. Changes to one do not affect the other. However, in dev mode, the app **auto-recovers** user data: if the dev DB is missing or demo-only and the installed app DB has user data, it copies the installed DB to the dev location on startup (backing up the dev DB first).

### Backup-Before-Wipe Requirement
Any script that deletes or recreates the database **must create a timestamped backup first**. `build_golden_copy.py` enforces this automatically:
- Detects user data (non-demo companies or >500 transactions)
- Refuses to wipe without `--force`
- Always backs up to `company_data/backups/` before deletion

### Recovery from Accidental Wipe
If the database was accidentally wiped or recreated:
1. Check `backend/company_data/backups/` (dev environment)
2. Check `Documents\LocalBooks\company_data\backups/` (installed app)
3. Restore by copying the most recent backup over `ledgerlocal.db`

### Incident Log (March 2026)
**Issue:** User's "Personal" company appeared missing when running the dev server.
**Root cause:** Dev DB was a freshly-seeded copy containing only Demo Company. The installed app DB (with all user data) was intact.
**Fix:** Added user-data detection, `--force` flag, and automatic backup to `build_golden_copy.py`. Added startup warning when only Demo Company exists.

---

## Code Review Requirements

Before any financial calculation code is merged:
1. Verify formula matches accounting standards
2. Check for consistent amount sign handling
3. Ensure proper decimal precision
4. Add unit tests with edge cases
5. Update this rules document if adding new calculation types
6. Run `pytest tests/test_calculations.py` and ensure all tests pass
