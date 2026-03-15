"""Financial calculation validation service.

This module provides validation functions for critical financial calculations
to ensure accuracy and consistency across the application.
"""

from typing import Tuple


def validate_net_income(income: float, expenses: float, net_income: float) -> bool:
    """Validate that net_income = income - abs(expenses).
    
    Args:
        income: Total income amount (positive value)
        expenses: Total expenses amount (negative value stored in DB)
        net_income: Calculated net income to validate
        
    Returns:
        True if calculation is correct within 0.01 tolerance
        
    Example:
        >>> validate_net_income(100.0, -50.0, 50.0)
        True
        >>> validate_net_income(54.0, -551.0, -497.0)
        True
        >>> validate_net_income(54.0, -551.0, 605.0)  # Wrong calculation
        False
    """
    expected = income - abs(expenses)
    return abs(net_income - expected) < 0.01


def validate_balance_sheet(assets: float, liabilities: float, equity: float) -> bool:
    """Validate that assets = liabilities + equity.
    
    Args:
        assets: Total assets amount
        liabilities: Total liabilities amount (stored as negative)
        equity: Total equity amount
        
    Returns:
        True if accounting equation balances within 0.01 tolerance
        
    Example:
        >>> validate_balance_sheet(1000.0, -400.0, 600.0)
        True
        >>> validate_balance_sheet(1000.0, -500.0, 500.0)
        True
    """
    return abs(assets - (abs(liabilities) + equity)) < 0.01


def validate_expense_calculation(expense_transactions: list, expected_total: float) -> Tuple[bool, float]:
    """Validate expense total calculation from transaction list.
    
    Args:
        expense_transactions: List of transaction amounts (negative values)
        expected_total: Expected total expense amount (positive value)
        
    Returns:
        Tuple of (is_valid, calculated_total)
        
    Example:
        >>> validate_expense_calculation([-100.0, -200.0, -50.0], 350.0)
        (True, 350.0)
    """
    calculated = abs(sum(expense_transactions))
    is_valid = abs(calculated - expected_total) < 0.01
    return is_valid, calculated


def validate_income_calculation(income_transactions: list, expected_total: float) -> Tuple[bool, float]:
    """Validate income total calculation from transaction list.
    
    Args:
        income_transactions: List of transaction amounts (positive values)
        expected_total: Expected total income amount
        
    Returns:
        Tuple of (is_valid, calculated_total)
    """
    calculated = sum(income_transactions)
    is_valid = abs(calculated - expected_total) < 0.01
    return is_valid, calculated


def get_calculation_errors(income: float, expenses: float, net_income: float,
                          assets: float, liabilities: float, equity: float) -> list:
    """Get list of all calculation errors for a financial report.
    
    Args:
        income: Total income
        expenses: Total expenses (negative value)
        net_income: Calculated net income
        assets: Total assets
        liabilities: Total liabilities (negative value)
        equity: Total equity
        
    Returns:
        List of error messages, empty if all calculations are valid
    """
    errors = []
    
    if not validate_net_income(income, expenses, net_income):
        expected = income - abs(expenses)
        errors.append(f"Net income calculation error: expected {expected}, got {net_income}")
    
    if not validate_balance_sheet(assets, liabilities, equity):
        expected_equity = assets - abs(liabilities)
        errors.append(f"Balance sheet error: Assets ({assets}) != Liabilities ({abs(liabilities)}) + Equity ({equity})")
    
    return errors
