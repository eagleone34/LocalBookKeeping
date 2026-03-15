"""Unit tests for financial calculations.

These tests validate the accuracy of critical financial calculations
to prevent regression and ensure data integrity.
"""

import pytest
from app.services.validation_service import (
    validate_net_income,
    validate_balance_sheet,
    validate_expense_calculation,
    validate_income_calculation,
    get_calculation_errors
)


class TestNetIncomeCalculation:
    """Test net income calculation accuracy."""
    
    def test_basic_net_income(self):
        """Test basic net income: income - expenses."""
        assert validate_net_income(100.0, -50.0, 50.0) == True
        assert validate_net_income(100.0, -50.0, 150.0) == False
    
    def test_net_income_with_zero_expenses(self):
        """Test net income when there are no expenses."""
        assert validate_net_income(1000.0, 0.0, 1000.0) == True
    
    def test_net_income_with_zero_income(self):
        """Test net income when there is no income."""
        assert validate_net_income(0.0, -500.0, -500.0) == True
    
    def test_net_income_negative_result(self):
        """Test net income that results in negative value."""
        # $54 income - $551 expenses = -$497 net income
        assert validate_net_income(54.0, -551.0, -497.0) == True
        assert validate_net_income(54.0, -551.0, 605.0) == False  # Wrong: 54 + 551
    
    def test_net_income_large_numbers(self):
        """Test net income with large realistic numbers."""
        assert validate_net_income(12500.0, -8750.0, 3750.0) == True
        assert validate_net_income(50000.0, -35000.0, 15000.0) == True
    
    def test_net_income_floating_point_tolerance(self):
        """Test that small floating point differences are tolerated."""
        assert validate_net_income(100.0, -33.33, 66.67) == True
        # Should pass within 0.01 tolerance
        assert validate_net_income(100.0, -33.333, 66.667) == True


class TestBalanceSheetValidation:
    """Test balance sheet equation validation."""
    
    def test_basic_balance_sheet(self):
        """Test basic balance sheet: assets = liabilities + equity."""
        assert validate_balance_sheet(1000.0, -400.0, 600.0) == True
        assert validate_balance_sheet(1000.0, -500.0, 500.0) == True
    
    def test_balance_sheet_imbalanced(self):
        """Test that imbalanced sheets are detected."""
        assert validate_balance_sheet(1000.0, -400.0, 500.0) == False
        assert validate_balance_sheet(1000.0, -300.0, 600.0) == False
    
    def test_balance_sheet_zero_values(self):
        """Test balance sheet with zero values."""
        assert validate_balance_sheet(0.0, 0.0, 0.0) == True
        assert validate_balance_sheet(1000.0, 0.0, 1000.0) == True
    
    def test_balance_sheet_large_numbers(self):
        """Test balance sheet with large realistic numbers."""
        assert validate_balance_sheet(100000.0, -45000.0, 55000.0) == True
        assert validate_balance_sheet(500000.0, -200000.0, 300000.0) == True


class TestExpenseCalculation:
    """Test expense calculation from transactions."""
    
    def test_basic_expense_calculation(self):
        """Test summing expense transactions."""
        transactions = [-100.0, -200.0, -50.0]
        is_valid, total = validate_expense_calculation(transactions, 350.0)
        assert is_valid == True
        assert total == 350.0
    
    def test_expense_calculation_with_variance(self):
        """Test expense calculation with realistic variance."""
        transactions = [-2800.0, -450.0, -125.0, -850.0]
        is_valid, total = validate_expense_calculation(transactions, 4225.0)
        assert is_valid == True
    
    def test_expense_calculation_empty(self):
        """Test expense calculation with no transactions."""
        is_valid, total = validate_expense_calculation([], 0.0)
        assert is_valid == True
        assert total == 0.0


class TestIncomeCalculation:
    """Test income calculation from transactions."""
    
    def test_basic_income_calculation(self):
        """Test summing income transactions."""
        transactions = [1000.0, 2500.0, 1500.0]
        is_valid, total = validate_income_calculation(transactions, 5000.0)
        assert is_valid == True
        assert total == 5000.0
    
    def test_income_calculation_realistic(self):
        """Test income calculation with realistic business numbers."""
        transactions = [12500.0, 8750.0, 15200.0, 5000.0, 3200.0]
        is_valid, total = validate_income_calculation(transactions, 44650.0)
        assert is_valid == True


class TestCalculationErrors:
    """Test error detection for financial calculations."""
    
    def test_no_errors_when_valid(self):
        """Test that no errors are returned for valid calculations."""
        errors = get_calculation_errors(
            income=1000.0,
            expenses=-500.0,
            net_income=500.0,
            assets=10000.0,
            liabilities=-4000.0,
            equity=6000.0
        )
        assert len(errors) == 0
    
    def test_net_income_error_detected(self):
        """Test that net income errors are detected."""
        errors = get_calculation_errors(
            income=54.0,
            expenses=-551.0,
            net_income=605.0,  # Wrong: should be -497
            assets=10000.0,
            liabilities=-4000.0,
            equity=6000.0
        )
        assert len(errors) == 1
        assert "Net income calculation error" in errors[0]
    
    def test_balance_sheet_error_detected(self):
        """Test that balance sheet errors are detected."""
        errors = get_calculation_errors(
            income=1000.0,
            expenses=-500.0,
            net_income=500.0,
            assets=10000.0,
            liabilities=-3000.0,  # Wrong: should be 4000 for equity of 6000
            equity=6000.0
        )
        assert len(errors) == 1
        assert "Balance sheet error" in errors[0]
    
    def test_multiple_errors_detected(self):
        """Test that multiple errors can be detected at once."""
        errors = get_calculation_errors(
            income=54.0,
            expenses=-551.0,
            net_income=605.0,  # Wrong
            assets=10000.0,
            liabilities=-3000.0,  # Wrong
            equity=6000.0
        )
        assert len(errors) == 2


class TestCriticalAuditScenario:
    """Test the specific scenario from the audit report."""
    
    def test_audit_scenario_net_income(self):
        """
        Audit found: Net income showed $605 instead of -$497
        Should be: $54 income - $551 expenses = -$497
        """
        # This is the exact scenario from the audit
        income = 54.0
        expenses = -551.0
        wrong_net_income = 605.0  # What was being calculated (54 + 551)
        correct_net_income = -497.0  # What should be calculated (54 - 551)
        
        assert validate_net_income(income, expenses, correct_net_income) == True
        assert validate_net_income(income, expenses, wrong_net_income) == False
    
    def test_audit_scenario_with_realistic_numbers(self):
        """Test with the realistic demo data amounts."""
        # Sales Revenue: $12,500 + $8,750 + $15,200 = $36,450
        # Consulting Income: $5,000 + $3,200 = $8,200
        total_income = 44650.0
        
        # Various expenses from demo data
        total_expenses = -4225.0  # Sum of major expenses
        
        expected_net = total_income - abs(total_expenses)
        assert validate_net_income(total_income, total_expenses, expected_net) == True
