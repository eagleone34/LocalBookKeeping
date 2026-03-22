"""
Seed realistic sample data for demo purposes.
Creates accounts, vendors, transactions, budgets, and rules
that look like a real small business.
"""
from __future__ import annotations

import random
import sqlite3
from datetime import datetime, timedelta

from app.services.data_service import (
    create_account, create_rule, create_transaction, upsert_budget,
    list_accounts, ensure_company, upsert_bank_account
)


def seed_default_accounts(conn: sqlite3.Connection, company_id: int) -> dict:
    """Create default chart of accounts, rules, and a default bank account for a company.
    
    This function is idempotent — safe to call multiple times.
    If the company already has accounts, it skips account/rule creation
    but still ensures at least one bank account exists.
    """
    existing = conn.execute(
        "SELECT COUNT(*) as cnt FROM accounts WHERE company_id=?",
        (company_id,),
    ).fetchone()

    account_map = {}

    if existing["cnt"] > 0:
        # Company already has accounts — build account_map from existing data
        rows = list_accounts(conn, company_id)
        for r in rows:
            account_map[r["name"]] = r["id"]
    else:
        # ── Create Accounts ──
        account_map = _create_default_accounts(conn, company_id)

    # ── Ensure at least one bank account exists ──
    has_bank = conn.execute(
        "SELECT COUNT(*) as cnt FROM bank_accounts WHERE company_id=?",
        (company_id,),
    ).fetchone()
    if has_bank["cnt"] == 0:
        checking_id = account_map.get("Checking Account")
        upsert_bank_account(
            conn, company_id,
            bank_name="General",
            last_four="0000",
            full_number="",
            ledger_account_id=checking_id,
        )

    return account_map


def _create_default_accounts(conn: sqlite3.Connection, company_id: int) -> dict:
    """Internal helper: create the default chart of accounts and categorization rules."""
    # ── Create Accounts ──
    income_accounts = [
        ("Sales Revenue", "income", None, "4000"),
        ("Consulting Income", "income", None, "4100"),
        ("Interest Income", "income", None, "4200"),
    ]
    expense_accounts = [
        ("Rent", "expense", None, "5000"),
        ("Utilities", "expense", None, "5100"),
        ("Office Supplies", "expense", None, "5200"),
        ("Travel", "expense", None, "5300"),
        ("Meals & Entertainment", "expense", None, "5400"),
        ("Software & Subscriptions", "expense", None, "5500"),
        ("Marketing", "expense", None, "5600"),
        ("Insurance", "expense", None, "5700"),
        ("Professional Services", "expense", None, "5800"),
        ("Miscellaneous", "expense", None, "5900"),
    ]
    asset_accounts = [
        ("Checking Account", "asset", None, "1000"),
        ("Cash on Hand", "asset", None, "1100"),
        ("Accounts Receivable", "asset", None, "1200"),
    ]
    liability_accounts = [
        ("Chase Corporate Card", "liability", None, "2000"),
        ("Line of Credit", "liability", None, "2100"),
    ]

    account_map = {}
    for name, atype, parent, code in income_accounts + expense_accounts + asset_accounts + liability_accounts:
        aid = create_account(conn, company_id, name, atype, parent, code)
        account_map[name] = aid

    # ── Create Default Categorization Rules ──
    rules = [
        ("uber", "contains", "Travel"),
        ("lyft", "contains", "Travel"),
        ("airline", "contains", "Travel"),
        ("marriott", "contains", "Travel"),
        ("staples", "contains", "Office Supplies"),
        ("amazon", "contains", "Office Supplies"),
        ("doordash", "contains", "Meals & Entertainment"),
        ("starbucks", "contains", "Meals & Entertainment"),
        ("panera", "contains", "Meals & Entertainment"),
        ("google ads", "contains", "Marketing"),
        ("facebook ads", "contains", "Marketing"),
        ("microsoft", "contains", "Software & Subscriptions"),
        ("slack", "contains", "Software & Subscriptions"),
        ("adobe", "contains", "Software & Subscriptions"),
        ("hydro", "contains", "Utilities"),
        ("electric", "contains", "Utilities"),
        ("internet", "contains", "Utilities"),
        ("insurance", "contains", "Insurance"),
        ("rent", "contains", "Rent"),
    ]

    for pattern, match_type, account_name in rules:
        account_id = account_map.get(account_name)
        if account_id:
            create_rule(conn, company_id, pattern, match_type, account_id)

    return account_map


def seed_demo_data(conn: sqlite3.Connection, company_id: int) -> None:
    """Seed comprehensive demo data if the database is empty."""
    existing = conn.execute("SELECT COUNT(*) as cnt FROM accounts WHERE company_id=?", (company_id,)).fetchone()
    if existing["cnt"] > 0:
        return

    account_map = seed_default_accounts(conn, company_id)

    # ── Create Demo Bank Accounts linked to COA Asset accounts ──
    # Create bank accounts and link them to Asset accounts in the COA
    chase_checking_asset_id = account_map.get("Checking Account")
    chase_id = upsert_bank_account(
        conn, company_id,
        bank_name="Chase",
        last_four="1234",
        full_number="",
        ledger_account_id=chase_checking_asset_id
    )
    
    corporate_card_liability_id = account_map.get("Chase Corporate Card")
    corp_card_id = upsert_bank_account(
        conn, company_id,
        bank_name="Chase Corporate Card",
        last_four="5678",
        full_number="",
        ledger_account_id=corporate_card_liability_id
    )

    # ── Create Transactions (9 months of realistic data) ──
    # Each transaction has:
    # - category_id = COA expense/income account (the "Category")
    # - bank_account_id = source bank account (the "Account")
    vendors_by_category = {
        "Sales Revenue": [("Acme Corp", 125000.00), ("Beta LLC", 87500.00), ("Gamma Inc", 152000.00)],
        "Consulting Income": [("TechStart Inc", 50000.00), ("FinancePartners", 32000.00)],
        "Rent": [("Metro Properties", -12800.00)],
        "Utilities": [("City Power", -1450.00), ("Waterworks Co", -1380.00)],
        "Office Supplies": [("Staples", -1125.00), ("Amazon Business", -890.00)],
        "Travel": [("United Airlines", -4850.00), ("Marriott", -5200.00)],
        "Meals & Entertainment": [("Panera Bread", -450.00), ("DoorDash", -650.00), ("Starbucks", -280.00)],
        "Software & Subscriptions": [("Microsoft 365", -1125.00), ("Slack", -850.00), ("Adobe Creative", -1195.00)],
        "Marketing": [("Google Ads", -8500.00), ("Facebook Ads", -6200.00)],
        "Insurance": [("StateFarm", -3400.00)],
        "Professional Services": [("Smith & Associates CPA", -12500.00)],
        "Miscellaneous": [("Office Depot", -750.00), ("PostNet Shipping", -450.00)],
    }

    base_date = datetime(2025, 7, 1)

    for month_offset in range(9):  # July 2025 through March 2026
        month_start = base_date + timedelta(days=month_offset * 30)

        for category_name, vendor_list in vendors_by_category.items():
            # category_id = the COA category (expense/income account)
            category_id = account_map.get(category_name)
            if not category_id:
                continue

            for vendor_name, base_amount in vendor_list:
                # Add some variance
                variance = random.uniform(0.85, 1.25)
                amount = round(base_amount * variance, 2)

                # Some vendors appear multiple times per month
                occurrences = 1
                if abs(base_amount) < 50:
                    occurrences = random.randint(2, 5)

                for _ in range(occurrences):
                    day_offset = random.randint(1, 28)
                    txn_date = (month_start + timedelta(days=day_offset)).strftime("%Y-%m-%d")
                    actual_amount = round(amount * random.uniform(0.8, 1.2), 2)

                    desc_options = [
                        f"Payment to {vendor_name}",
                        f"{vendor_name} - {category_name}",
                        f"Invoice from {vendor_name}",
                        f"{vendor_name}",
                    ]

                    # Assign a bank account (80% Checking, 20% Corporate Card)
                    # This demonstrates the Account/Category separation:
                    # - bank_account_id = which account the transaction came from
                    # - category_id = what the transaction was for
                    assigned_bank_id = chase_id if random.random() > 0.2 else corp_card_id

                    create_transaction(
                        conn, company_id,
                        account_id=category_id,      # COA category (expense/income)
                        txn_date=txn_date,
                        amount=actual_amount,
                        description=random.choice(desc_options),
                        vendor_name=vendor_name,
                        source="manual",
                        bank_account_id=assigned_bank_id,  # Source bank account
                    )

    # ── Create Budgets (for each expense account, each month) ──
    budget_amounts = {
        "Rent": 12800.00,
        "Utilities": 2850.00,
        "Office Supplies": 2250.00,
        "Travel": 12500.00,
        "Meals & Entertainment": 1500.00,
        "Software & Subscriptions": 3450.00,
        "Marketing": 15800.00,
        "Insurance": 3400.00,
        "Professional Services": 12800.00,
        "Miscellaneous": 1200.00,
    }

    for month_offset in range(9):
        month_start = base_date + timedelta(days=month_offset * 30)
        month_str = month_start.strftime("%Y-%m")
        for name, amt in budget_amounts.items():
            account_id = account_map.get(name)
            if account_id:
                upsert_budget(conn, company_id, account_id, month_str, amt)

