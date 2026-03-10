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
    list_accounts, ensure_company,
)


def seed_default_accounts(conn: sqlite3.Connection, company_id: int) -> dict:
    """Create default chart of accounts and rules for a new company."""
    # ── Create Accounts ──
    income_accounts = [
        ("Sales Revenue", "income", None, "1000"),
        ("Consulting Income", "income", None, "1100"),
        ("Interest Income", "income", None, "1200"),
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
        ("Business Checking", "asset", None, "1000"),
        ("Savings Account", "asset", None, "1100"),
        ("Accounts Receivable", "asset", None, "1200"),
    ]
    liability_accounts = [
        ("Credit Card", "liability", None, "2000"),
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

    # ── Create Transactions (6 months of realistic data) ──
    vendors_by_category = {
        "Sales Revenue": [("Acme Corp", 2500), ("Beta LLC", 1800), ("Gamma Inc", 3200), ("Delta Co", 950)],
        "Consulting Income": [("TechStart Inc", 5000), ("FinancePartners", 3500)],
        "Rent": [("Metro Properties", -2200)],
        "Utilities": [("City Power", -185), ("Waterworks Co", -65), ("Metro Gas", -95), ("Fiber Internet", -120)],
        "Office Supplies": [("Staples", -45), ("Amazon Business", -85), ("OfficeMax", -35)],
        "Travel": [("United Airlines", -450), ("Uber", -28), ("Marriott", -189), ("Lyft", -22), ("Delta Airlines", -380)],
        "Meals & Entertainment": [("Panera Bread", -18), ("DoorDash", -32), ("Starbucks", -7), ("The Capital Grille", -95)],
        "Software & Subscriptions": [("Microsoft 365", -30), ("Slack", -15), ("Adobe Creative", -55), ("Zoom", -20), ("GitHub", -10)],
        "Marketing": [("Google Ads", -350), ("Facebook Ads", -200), ("Mailchimp", -45)],
        "Insurance": [("StateFarm", -280)],
        "Professional Services": [("Smith & Associates CPA", -500), ("Legal Shield", -150)],
        "Miscellaneous": [("Office Depot", -25), ("PostNet Shipping", -18)],
    }

    base_date = datetime(2025, 7, 1)

    for month_offset in range(9):  # July 2025 through March 2026
        month_start = base_date + timedelta(days=month_offset * 30)

        for category, vendor_list in vendors_by_category.items():
            account_id = account_map.get(category)
            if not account_id:
                continue

            for vendor_name, base_amount in vendor_list:
                # Add some variance
                variance = random.uniform(0.85, 1.25)
                amount = round(base_amount * variance, 2)

                # Spread transactions across the month
                day_offset = random.randint(1, 28)
                txn_date = (month_start + timedelta(days=day_offset)).strftime("%Y-%m-%d")

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
                        f"{vendor_name} - {category}",
                        f"Invoice from {vendor_name}",
                        f"{vendor_name}",
                    ]

                    create_transaction(
                        conn, company_id, account_id, txn_date, actual_amount,
                        description=random.choice(desc_options),
                        vendor_name=vendor_name,
                        source="manual",
                    )

    # ── Create Budgets (for each expense account, each month) ──
    budget_amounts = {
        "Rent": 2200,
        "Utilities": 500,
        "Office Supplies": 200,
        "Travel": 800,
        "Meals & Entertainment": 400,
        "Software & Subscriptions": 150,
        "Marketing": 600,
        "Insurance": 300,
        "Professional Services": 700,
        "Miscellaneous": 100,
    }

    for month_offset in range(9):
        month_start = base_date + timedelta(days=month_offset * 30)
        month_str = month_start.strftime("%Y-%m")
        for name, amt in budget_amounts.items():
            account_id = account_map.get(name)
            if account_id:
                upsert_budget(conn, company_id, account_id, month_str, amt)

