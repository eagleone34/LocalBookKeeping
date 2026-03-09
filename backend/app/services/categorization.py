"""
Smart Categorization Engine.

Priority order:
1. Exact match rules
2. Contains match rules
3. Regex match rules
4. Vendor-account memory (learned from user behavior)
5. Keyword heuristics
"""
from __future__ import annotations

import re
import sqlite3
from typing import Optional, Tuple

from app.services.data_service import get_vendor_account_suggestion


def suggest_account(conn: sqlite3.Connection, company_id: int,
                    description: str, vendor_name: str) -> Tuple[Optional[int], float]:
    """
    Given a transaction description and vendor name, suggest the best account.
    Returns (account_id, confidence) where confidence is 0.0-1.0.
    """
    text = f"{vendor_name or ''} {description or ''}".strip().lower()
    if not text:
        return None, 0.0

    # 1. Check user-defined categorization rules
    rules = conn.execute(
        """SELECT account_id, pattern, match_type, priority
           FROM categorization_rules
           WHERE company_id=? AND is_active=1
           ORDER BY priority ASC""",
        (company_id,),
    ).fetchall()

    for rule in rules:
        pattern = rule["pattern"].lower()
        match_type = rule["match_type"]
        try:
            if match_type == "exact" and pattern == text:
                return int(rule["account_id"]), 0.95
            elif match_type == "contains" and pattern in text:
                return int(rule["account_id"]), 0.90
            elif match_type == "regex" and re.search(pattern, text):
                return int(rule["account_id"]), 0.85
        except re.error:
            continue

    # 2. Check vendor-account memory (learned mappings)
    if vendor_name:
        result = get_vendor_account_suggestion(conn, company_id, vendor_name)
        if result:
            return result

    # 3. Keyword heuristics (fallback)
    keyword_map = {
        "uber": "Travel",
        "lyft": "Travel",
        "airline": "Travel",
        "hotel": "Travel",
        "flight": "Travel",
        "amazon": "Office Supplies",
        "staples": "Office Supplies",
        "office depot": "Office Supplies",
        "restaurant": "Meals & Entertainment",
        "doordash": "Meals & Entertainment",
        "grubhub": "Meals & Entertainment",
        "hydro": "Utilities",
        "electric": "Utilities",
        "internet": "Utilities",
        "phone": "Utilities",
        "insurance": "Insurance",
        "rent": "Rent",
        "software": "Software & Subscriptions",
        "subscription": "Software & Subscriptions",
        "stripe": "Sales",
        "payment received": "Sales",
        "deposit": "Sales",
    }

    for keyword, account_name in keyword_map.items():
        if keyword in text:
            row = conn.execute(
                "SELECT id FROM accounts WHERE company_id=? AND LOWER(name)=LOWER(?) AND is_active=1",
                (company_id, account_name),
            ).fetchone()
            if row:
                return int(row["id"]), 0.5

    return None, 0.1
