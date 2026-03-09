"""
Smart Categorization Engine.

Priority order:
1. Exact match rules (user-defined)
2. Contains match rules (user-defined)
3. Regex match rules (user-defined)
4. Vendor-account memory (learned from user behavior) - exact match
5. Vendor-account memory - fuzzy/partial match
6. Keyword heuristics (built-in defaults)

The engine gets smarter over time as users approve/recategorize transactions.
"""
from __future__ import annotations

import re
import sqlite3
from typing import Optional, Tuple


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
                return int(rule["account_id"]), 0.98
            elif match_type == "contains" and pattern in text:
                return int(rule["account_id"]), 0.93
            elif match_type == "regex" and re.search(pattern, text):
                return int(rule["account_id"]), 0.88
        except re.error:
            continue

    # 2. Vendor-account memory - exact match on vendor name
    if vendor_name and vendor_name.strip():
        exact = _get_vendor_suggestion(conn, company_id, vendor_name.strip())
        if exact:
            return exact

    # 3. Vendor-account memory - try normalized vendor name (remove noise)
    if vendor_name:
        normalized = _normalize_vendor_for_lookup(vendor_name)
        if normalized and normalized != vendor_name.strip():
            fuzzy = _get_vendor_suggestion(conn, company_id, normalized)
            if fuzzy:
                acct_id, conf = fuzzy
                return acct_id, min(conf, 0.85)  # cap fuzzy at 85%

    # 4. Vendor-account memory - partial match on description words
    if description:
        partial = _partial_vendor_match(conn, company_id, description)
        if partial:
            return partial

    # 5. Keyword heuristics (built-in defaults)
    keyword_result = _keyword_heuristic(conn, company_id, text)
    if keyword_result:
        return keyword_result

    return None, 0.1


def _get_vendor_suggestion(conn: sqlite3.Connection, company_id: int,
                           vendor_name: str) -> Optional[Tuple[int, float]]:
    """Look up vendor-account mapping with exact match."""
    row = conn.execute(
        "SELECT account_id, hit_count FROM vendor_account_map WHERE company_id=? AND vendor_name=?",
        (company_id, vendor_name),
    ).fetchone()
    if row:
        hits = int(row["hit_count"])
        confidence = min(0.95, 0.6 + (hits * 0.05))
        return int(row["account_id"]), confidence
    return None


def _normalize_vendor_for_lookup(vendor_name: str) -> str:
    """Normalize vendor name for fuzzy matching."""
    name = vendor_name.lower().strip()
    # Remove common suffixes
    for suffix in [" inc", " inc.", " llc", " ltd", " ltd.", " corp", " corp.",
                   " co", " co.", " company", " international", " intl"]:
        if name.endswith(suffix):
            name = name[:-len(suffix)]
    # Remove numbers (like store numbers)
    name = re.sub(r"\s*#?\d+\s*$", "", name)
    return name.strip()


def _partial_vendor_match(conn: sqlite3.Connection, company_id: int,
                          description: str) -> Optional[Tuple[int, float]]:
    """Try to match description words against known vendor names."""
    desc_lower = description.lower()
    rows = conn.execute(
        "SELECT vendor_name, account_id, hit_count FROM vendor_account_map WHERE company_id=? ORDER BY hit_count DESC",
        (company_id,),
    ).fetchall()

    best_match = None
    best_score = 0

    for row in rows:
        vname = row["vendor_name"].lower()
        if not vname:
            continue

        # Check if vendor name appears in description
        if vname in desc_lower:
            score = len(vname) / max(len(desc_lower), 1)
            hits = int(row["hit_count"])
            confidence = min(0.80, 0.45 + score + (hits * 0.03))
            if confidence > best_score:
                best_score = confidence
                best_match = (int(row["account_id"]), confidence)

        # Check if first significant word of vendor matches
        vwords = vname.split()
        if vwords and len(vwords[0]) >= 4:
            if vwords[0] in desc_lower:
                hits = int(row["hit_count"])
                confidence = min(0.70, 0.40 + (hits * 0.03))
                if confidence > best_score:
                    best_score = confidence
                    best_match = (int(row["account_id"]), confidence)

    return best_match


def _keyword_heuristic(conn: sqlite3.Connection, company_id: int,
                       text: str) -> Optional[Tuple[int, float]]:
    """Built-in keyword matching as last resort."""
    keyword_map = {
        # Travel
        "uber": "Travel", "lyft": "Travel", "airline": "Travel",
        "hotel": "Travel", "flight": "Travel", "airbnb": "Travel",
        "delta air": "Travel", "united air": "Travel", "southwest": "Travel",
        "marriott": "Travel", "hilton": "Travel", "expedia": "Travel",
        # Office
        "amazon": "Office Supplies", "staples": "Office Supplies",
        "office depot": "Office Supplies", "best buy": "Office Supplies",
        # Food & Entertainment
        "restaurant": "Meals & Entertainment", "doordash": "Meals & Entertainment",
        "grubhub": "Meals & Entertainment", "uber eats": "Meals & Entertainment",
        "starbucks": "Meals & Entertainment", "mcdonald": "Meals & Entertainment",
        "chipotle": "Meals & Entertainment",
        # Utilities
        "hydro": "Utilities", "electric": "Utilities", "internet": "Utilities",
        "phone": "Utilities", "water": "Utilities", "gas company": "Utilities",
        "comcast": "Utilities", "at&t": "Utilities", "verizon": "Utilities",
        "t-mobile": "Utilities",
        # Insurance
        "insurance": "Insurance", "geico": "Insurance", "state farm": "Insurance",
        # Rent
        "rent": "Rent", "lease": "Rent",
        # Software
        "software": "Software & Subscriptions", "subscription": "Software & Subscriptions",
        "google cloud": "Software & Subscriptions", "aws": "Software & Subscriptions",
        "microsoft": "Software & Subscriptions", "adobe": "Software & Subscriptions",
        "slack": "Software & Subscriptions", "zoom": "Software & Subscriptions",
        "github": "Software & Subscriptions", "heroku": "Software & Subscriptions",
        # Revenue
        "stripe": "Sales Revenue", "payment received": "Sales Revenue",
        "deposit": "Sales Revenue", "paypal received": "Sales Revenue",
        "square": "Sales Revenue",
        # Banking
        "interest earned": "Interest Income", "interest charge": "Interest Expense",
        "bank fee": "Bank Fees", "service charge": "Bank Fees",
        "overdraft": "Bank Fees", "wire fee": "Bank Fees",
        "atm fee": "Bank Fees", "monthly fee": "Bank Fees",
        # Professional
        "legal": "Professional Services", "attorney": "Professional Services",
        "accountant": "Professional Services", "consulting": "Professional Services",
        "lawyer": "Professional Services",
        # Advertising
        "facebook ads": "Advertising", "google ads": "Advertising",
        "advertising": "Advertising", "marketing": "Advertising",
    }

    for keyword, account_name in keyword_map.items():
        if keyword in text:
            # Try exact match first, then try partial match on account name
            row = conn.execute(
                "SELECT id FROM accounts WHERE company_id=? AND LOWER(name)=LOWER(?) AND is_active=1",
                (company_id, account_name),
            ).fetchone()
            if row:
                return int(row["id"]), 0.5

            # Try partial match
            row = conn.execute(
                "SELECT id FROM accounts WHERE company_id=? AND LOWER(name) LIKE ? AND is_active=1 LIMIT 1",
                (company_id, f"%{account_name.lower()}%"),
            ).fetchone()
            if row:
                return int(row["id"]), 0.4

    return None
