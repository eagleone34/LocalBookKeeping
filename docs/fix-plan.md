# Fix Plan - LedgerLocal Financial Calculations

**Created:** March 15, 2026
**Priority:** CRITICAL
**Estimated Implementation Time:** 2-3 days for critical fixes

## Overview

This document provides a step-by-step plan to fix the critical financial calculation errors identified in the audit. The fixes are ordered by priority and include specific code changes, file locations, and testing requirements.

## Priority 1: Critical Fixes (Do First)

### Fix 1.1: Dashboard Net Income Calculation
**File:** [`backend/app/routers/reports.py`](backend/app/routers/reports.py:82)
**Line:** 82
**Time Estimate:** 15 minutes

**Current Code:**
```python
net_income=totals.get("income", 0) + totals.get("expense", 0),
```

**Fixed Code:**
```python
net_income=totals.get("income", 0) - abs(totals.get("expense", 0)),
```

**Explanation:**
- Expenses are stored as negative values in the database
- `summary_totals()` returns the signed values
- Must subtract absolute value of expenses from income
- This matches the correct formula: Net Income = Income - Expenses

**Test Cases:**
```python
# Test 1: Positive net income
# income: 100, expense: -50 → net: 50
assert calculate_net_income(100, -50) == 50

# Test 2: Negative net income (loss)
# income: 50, expense: -100 → net: -50
assert calculate_net_income(50, -100) == -50

# Test 3: Zero net income
# income: 0, expense: 0 → net: 0
assert calculate_net_income(0, 0) == 0

# Test 4: User's reported case
# income: 54, expense: -551 → net: -497
assert calculate_net_income(54, -551) == -497
```

---

### Fix 1.2: Standardize Expense Amount Handling
**Files:** [`backend/app/services/data_service.py`](backend/app/services/data_service.py)
**Lines:** 607, 639, 666, 694
**Time Estimate:** 1 hour

**Problem:** Inconsistent use of ABS() vs signed values for expenses

**Changes Needed:**

#### Change 2.1: monthly_trend() - Line 694
**Current:**
```python
SUM(CASE WHEN a.type='expense' THEN ABS(t.amount) ELSE 0 END) AS expenses
```

**Fixed:**
```python
ABS(SUM(CASE WHEN a.type='expense' THEN t.amount ELSE 0 END)) AS expenses
```

**Rationale:** Sum the signed values first, then take absolute value for display

#### Change 2.2: budget_vs_actual() - Line 607
**Current:**
```python
SELECT account_id, strftime('%Y-%m', txn_date) AS month, SUM(ABS(amount)) as actual_amount
```

**Fixed:**
```python
SELECT account_id, strftime('%Y-%m', txn_date) AS month, SUM(amount) as actual_amount
```

**Rationale:** Store signed values for accurate variance calculation

#### Change 2.3: expense_by_category() - Line 639
**Current:**
```python
SUM(ABS(t.amount)) AS total
```

**Fixed:**
```python
ABS(SUM(t.amount)) AS total
```

**Rationale:** Sum first, then absolute for display consistency

#### Change 2.4: expense_by_vendor() - Line 666
**Current:**
```python
SUM(ABS(t.amount)) AS total
```

**Fixed:**
```python
ABS(SUM(t.amount)) AS total
```

**Rationale:** Sum first, then absolute for display consistency

**Test Cases:**
```python
# Test expense sum with mixed transactions
# Transaction 1: -100, Transaction 2: -200, Transaction 3: -50
# Expected sum: -350, Expected ABS: 350

# Test with refunds (positive expense transactions)
# Transaction 1: -100, Transaction 2: 25 (refund), Transaction 3: -50
# Expected sum: -125, Expected ABS: 125
```

---

### Fix 1.3: Budget vs Actual Variance Calculation
**File:** [`backend/app/services/data_service.py`](backend/app/services/data_service.py:615)
**Lines:** 607, 615
**Time Estimate:** 30 minutes

**Current Code:**
```python
# Line 607
SELECT account_id, strftime('%Y-%m', txn_date) AS month, SUM(ABS(amount)) as actual_amount

# Line 615
SUM(b.amount) - COALESCE(SUM(t.actual_amount), 0) AS variance
```

**Problem:**
- Budget amounts (`b.amount`) are positive
- Actual amounts use `ABS(amount)`, making them positive
- Variance calculation doesn't account for expense vs income account types

**Fixed Code:**
```python
# Line 607 - Use signed amounts
SELECT account_id, strftime('%Y-%m', txn_date) AS month, SUM(amount) as actual_amount

# Line 613-615 - Fix variance calculation based on account type
COALESCE(SUM(CASE 
    WHEN a.type = 'expense' THEN ABS(t.actual_amount)
    ELSE t.actual_amount 
END), 0) AS actual,
SUM(b.amount) - COALESCE(SUM(CASE 
    WHEN a.type = 'expense' THEN ABS(t.actual_amount)
    ELSE t.actual_amount 
END), 0) AS variance
```

**Alternative Simpler Fix:**
```python
# Change the CTE to use signed amounts
WITH monthly_actuals AS (
    SELECT account_id, strftime('%Y-%m', txn_date) AS month, SUM(amount) as actual_amount
    FROM transactions
    WHERE company_id=?
    GROUP BY account_id, month
)
# Then in main query, handle sign based on account type
COALESCE(SUM(CASE 
    WHEN a.type = 'expense' THEN ABS(t.actual_amount)
    ELSE t.actual_amount 
END), 0) AS actual,
SUM(b.amount) - COALESCE(SUM(CASE 
    WHEN a.type = 'expense' THEN ABS(t.actual_amount)
    ELSE t.actual_amount 
END), 0) AS variance
```

**Test Cases:**
```python
# Test 1: Expense account, under budget
# Budget: 1000, Actual: -800 (spent less)
# Variance: 1000 - 800 = 200 (positive, under budget)

# Test 2: Expense account, over budget
# Budget: 1000, Actual: -1200 (spent more)
# Variance: 1000 - 1200 = -200 (negative, over budget)

# Test 3: Income account, under budget
# Budget: 1000, Actual: 800 (earned less)
# Variance: 1000 - 800 = 200 (positive, but under budget)

# Test 4: Income account, over budget
# Budget: 1000, Actual: 1200 (earned more)
# Variance: 1000 - 1200 = -200 (negative, but over budget)
```

---

## Priority 2: High Priority Fixes

### Fix 2.1: Add Balance Sheet Validation
**File:** [`backend/app/services/data_service.py`](backend/app/services/data_service.py:756)
**Time Estimate:** 45 minutes

**Add after line 756:**
```python
# Validate accounting equation
asset_sum = sum(r["balance"] for r in rows if r["type"] == "asset")
liability_sum = sum(r["balance"] for r in rows if r["type"] == "liability")

# Note: Equity accounts not yet implemented, so we calculate equity as residual
equity = asset_sum + liability_sum  # liability_sum is negative

# Add validation (with small tolerance for rounding)
if abs(asset_sum - (liability_sum + equity)) > 0.01:
    # Log warning but don't fail - this indicates data issues
    print(f"Warning: Balance sheet doesn't balance. Assets: {asset_sum}, Liabilities: {liability_sum}, Equity: {equity}")
```

**Note:** Full equity account support requires database schema changes

---

### Fix 2.2: Add Data Integrity Checks
**File:** New file [`backend/app/services/validation_service.py`](backend/app/services/validation_service.py)
**Time Estimate:** 1 hour

**Create validation functions:**

```python
"""
Data validation service for financial data integrity
"""

def validate_transaction_amounts(conn: sqlite3.Connection, company_id: int) -> List[Dict]:
    """Check that transaction amounts have correct signs based on account type."""
    sql = """
        SELECT t.id, t.amount, a.type, a.name as account_name
        FROM transactions t
        JOIN accounts a ON t.account_id = a.id
        WHERE t.company_id=? 
          AND ((a.type='income' AND t.amount < 0) 
               OR (a.type='expense' AND t.amount > 0))
    """
    return [dict(r) for r in conn.execute(sql, (company_id,)).fetchall()]

def validate_account_balances(conn: sqlite3.Connection, company_id: int) -> Dict[str, float]:
    """Calculate and validate account balances."""
    sql = """
        SELECT a.type, SUM(t.amount) as balance
        FROM transactions t
        JOIN accounts a ON t.account_id = a.id
        WHERE t.company_id=?
        GROUP BY a.type
    """
    results = {}
    for r in conn.execute(sql, (company_id,)).fetchall():
        results[r["type"]] = float(r["balance"])
    
    # Validate signs
    issues = []
    if results.get("income", 0) < 0:
        issues.append(f"Total income is negative: {results.get('income')}")
    if results.get("expense", 0) > 0:
        issues.append(f"Total expenses is positive: {results.get('expense')}")
    
    return {"balances": results, "issues": issues}

def run_financial_validation(conn: sqlite3.Connection, company_id: int) -> Dict:
    """Run all financial validations and return report."""
    return {
        "invalid_transactions": validate_transaction_amounts(conn, company_id),
        "account_validation": validate_account_balances(conn, company_id),
        "timestamp": datetime.utcnow().isoformat()
    }
```

**Add API endpoint in reports.py:**
```python
@router.get("/validation")
def financial_validation():
    """Run financial data validation checks."""
    return ds.run_financial_validation(get_conn(), get_company_id())
```

---

### Fix 2.3: Create Unit Tests
**File:** New file [`backend/tests/test_calculations.py`](backend/tests/test_calculations.py)
**Time Estimate:** 2 hours

**Test structure:**

```python
"""
Unit tests for financial calculations
"""
import pytest
from app.services import data_service as ds

class TestNetIncomeCalculation:
    def test_positive_net_income(self, test_db):
        # Setup: Create income and expense transactions
        # Execute: Calculate net income
        # Assert: Result is correct
        pass
    
    def test_negative_net_income(self, test_db):
        # Setup: More expenses than income
        # Execute: Calculate net income
        # Assert: Result is negative (loss)
        pass
    
    def test_zero_net_income(self, test_db):
        # Setup: Equal income and expenses
        # Execute: Calculate net income
        # Assert: Result is zero
        pass

class TestExpenseAmountHandling:
    def test_expense_sum_with_signed_values(self, test_db):
        # Test that SUM of expenses returns negative value
        pass
    
    def test_expense_display_uses_absolute_value(self, test_db):
        # Test that display functions convert to positive
        pass

class TestBudgetVariance:
    def test_expense_under_budget(self, test_db):
        # Budget: 1000, Actual: -800 → Variance: 200 (positive)
        pass
    
    def test_expense_over_budget(self, test_db):
        # Budget: 1000, Actual: -1200 → Variance: -200 (negative)
        pass

class TestBalanceSheet:
    def test_balance_sheet_balances(self, test_db):
        # Test that assets = liabilities + equity
        pass
```

---

## Priority 3: Medium Priority Fixes

### Fix 3.1: Improve Decimal Precision
**File:** [`backend/app/database.py`](backend/app/database.py:58)
**Time Estimate:** 1 hour

**Current:**
```sql
amount REAL NOT NULL
```

**Option A: Store as INTEGER (cents)**
```sql
amount_cents INTEGER NOT NULL
```

**Option B: Use TEXT with decimal (future migration)**
```sql
amount TEXT NOT NULL  -- Store as string for exact precision
```

**Recommendation:** Option A for now, plan migration to Option B for v2.0

**Code changes needed:**
- Update database schema
- Update all amount handling to convert dollars to cents
- Update display functions to convert cents to dollars

---

### Fix 3.2: Add Reconciliation Report
**File:** New functionality in [`backend/app/services/data_service.py`](backend/app/services/data_service.py)
**Time Estimate:** 1.5 hours

**Add function:**
```python
def reconciliation_report(conn: sqlite3.Connection, company_id: int, 
                         date_from: str, date_to: str) -> Dict:
    """Generate reconciliation report for a period."""
    
    # Starting balances
    # Transactions during period
    # Ending balances
    # Verify: Starting + Transactions = Ending
    
    return {
        "period": f"{date_from} to {date_to}",
        "starting_balances": {},
        "transactions": {},
        "ending_balances": {},
        "reconciled": True/False,
        "discrepancies": []
    }
```

---

## Testing Strategy

### Before Deployment
1. Run all new unit tests
2. Run validation on existing data
3. Test with sample transactions
4. Verify dashboard displays correctly
5. Verify all reports match expected values

### After Deployment
1. Monitor validation endpoint for issues
2. Compare reports before/after fixes
3. User acceptance testing
4. Create backup before migration

### Rollback Plan
If issues arise:
1. Restore database from backup
2. Revert code changes
3. Investigate root cause
4. Apply fixes in test environment first

---

## Implementation Checklist

### Phase 1: Critical Fixes (Day 1)
- [ ] Fix dashboard net income calculation
- [ ] Standardize expense amount handling (4 locations)
- [ ] Fix budget variance calculation
- [ ] Run manual tests with sample data
- [ ] Deploy to staging

### Phase 2: Validation & Tests (Day 2-3)
- [ ] Create validation service
- [ ] Create unit tests
- [ ] Run validation on production data (read-only)
- [ ] Fix any data integrity issues found
- [ ] Deploy to production (critical fixes only)

### Phase 3: Enhancements (Week 2)
- [ ] Add balance sheet validation
- [ ] Improve decimal precision
- [ ] Add reconciliation reports
- [ ] Create user documentation
- [ ] Full deployment

### Phase 4: Monitoring (Ongoing)
- [ ] Monitor validation endpoint
- [ ] Track user-reported issues
- [ ] Performance monitoring
- [ ] Regular data integrity checks

---

## Risk Assessment

### High Risk
- **Data Migration:** Changing amount storage format requires careful migration
- **User Confusion:** Fixed calculations may show different numbers than before
- **Performance:** Additional validation may slow down reports

### Mitigation
- Create comprehensive backups
- Communicate changes to users
- Add caching for validation results
- Monitor performance metrics

### Low Risk
- Individual calculation fixes are isolated
- Can be rolled back individually
- Well-tested patterns

---

## Success Criteria

### Technical
- [ ] All unit tests pass
- [ ] Validation shows no data integrity issues
- [ ] Dashboard net income matches manual calculation
- [ ] All reports show consistent values
- [ ] Performance remains acceptable (< 2s for reports)

### Business
- [ ] User-reported issue resolved
- [ ] No new bug reports related to calculations
- [ ] Users confirm numbers look correct
- [ ] Support tickets decrease

---

## Communication Plan

### Internal
- Notify team of critical fixes
- Share test results
- Document changes in release notes
- Update onboarding docs

### External (Users)
- Email about important bug fixes
- Explain what was fixed and why numbers may change
- Provide contact for questions
- Offer data review if concerned

---

## Conclusion

This fix plan addresses all critical financial calculation errors identified in the audit. The plan is structured to minimize risk while ensuring accuracy. Priority 1 fixes should be implemented immediately, with subsequent phases following based on resource availability.

**Next Steps:**
1. Review this plan with the team
2. Assign developers to Priority 1 fixes
3. Set up test environment
4. Begin implementation
5. Schedule deployment
