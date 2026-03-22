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

import hashlib
import re
import sqlite3
from typing import Any, Dict, List, Optional, Tuple


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
            # Only suggest expense or income accounts (categories), not asset/liability (bank accounts)
            row = conn.execute(
                "SELECT id FROM accounts WHERE company_id=? AND LOWER(name)=LOWER(?) AND type IN ('expense', 'income') AND is_active=1",
                (company_id, account_name),
            ).fetchone()
            if row:
                return int(row["id"]), 0.5

            # Try partial match
            row = conn.execute(
                "SELECT id FROM accounts WHERE company_id=? AND LOWER(name) LIKE ? AND type IN ('expense', 'income') AND is_active=1 LIMIT 1",
                (company_id, f"%{account_name.lower()}%"),
            ).fetchone()
            if row:
                return int(row["id"]), 0.4

    return None


# ═══════════════════════════════════════════════════════
#  BATCH CATEGORY SUGGESTION (similar-transaction matching)
# ═══════════════════════════════════════════════════════

def _normalize_description(desc: str) -> str:
    """Normalize a description for grouping: lowercase, strip numbers/special chars, collapse whitespace."""
    text = desc.lower().strip()
    # Remove numbers (transaction IDs, amounts, dates embedded in descriptions)
    text = re.sub(r"\d+", "", text)
    # Remove special characters except spaces
    text = re.sub(r"[^a-z\s]", " ", text)
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _description_tokens(desc: str) -> set:
    """Extract meaningful word tokens from a description."""
    normalized = _normalize_description(desc)
    # Filter out very short words (likely noise)
    return {w for w in normalized.split() if len(w) >= 3}


def _jaccard_similarity(set_a: set, set_b: set) -> float:
    """Compute Jaccard similarity between two sets."""
    if not set_a or not set_b:
        return 0.0
    intersection = len(set_a & set_b)
    union = len(set_a | set_b)
    return intersection / union if union > 0 else 0.0


def _group_key(desc: str) -> str:
    """Generate a stable group key from a normalized description."""
    normalized = _normalize_description(desc)
    return hashlib.md5(normalized.encode()).hexdigest()[:12]


def suggest_categories_for_batch(
    conn: sqlite3.Connection,
    company_id: int,
    transactions: List[Dict[str, Any]],
    bank_account_id: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Smart batch categorization: groups similar incoming transactions together
    and suggests categories based on past transaction history.

    Args:
        conn: Database connection
        company_id: Company ID
        transactions: List of dicts with 'description', 'amount', 'date'
        bank_account_id: Optional bank account filter for past transactions

    Returns:
        {
            "groups": [
                {
                    "group_key": "abc123",
                    "sample_description": "UBER TRIP",
                    "transaction_indices": [0, 3, 7],
                    "suggested_category_id": 5,
                    "suggested_category_name": "Travel",
                    "confidence": 0.85,
                    "match_reason": "Similar to 12 previous transactions categorized as Travel"
                }, ...
            ],
            "ungrouped_indices": [2, 5]
        }
    """
    if not transactions:
        return {"groups": [], "ungrouped_indices": []}

    # ── Step 1: Group incoming transactions by normalized description ──
    groups: Dict[str, Dict[str, Any]] = {}
    index_to_group: Dict[int, str] = {}

    for i, txn in enumerate(transactions):
        desc = txn.get("description", "")
        tokens = _description_tokens(desc)
        if not tokens:
            # Can't group transactions with no meaningful description
            continue

        # Try to merge into an existing group by similarity
        matched_key = None
        best_sim = 0.0
        for gkey, gdata in groups.items():
            sim = _jaccard_similarity(tokens, gdata["tokens"])
            if sim > 0.6 and sim > best_sim:
                best_sim = sim
                matched_key = gkey

        if matched_key:
            groups[matched_key]["indices"].append(i)
        else:
            gkey = _group_key(desc)
            # Handle hash collisions by appending index
            if gkey in groups:
                gkey = f"{gkey}_{i}"
            groups[gkey] = {
                "tokens": tokens,
                "sample_description": desc,
                "indices": [i],
            }
            index_to_group[i] = gkey

    # ── Step 2: Get existing categorized transactions from the database ──
    past_sql = """
        SELECT t.description, t.amount, t.category_id as account_id, a.name AS account_name
        FROM transactions t
        JOIN accounts a ON t.category_id = a.id
        WHERE t.company_id = ? AND a.type IN ('income', 'expense')
    """
    past_params: list = [company_id]
    if bank_account_id:
        past_sql += " AND t.bank_account_id = ?"
        past_params.append(bank_account_id)
    past_sql += " ORDER BY t.txn_date DESC LIMIT 2000"
    past_rows = conn.execute(past_sql, past_params).fetchall()

    # Build a lookup of past transaction tokens → category info
    past_entries: List[Dict[str, Any]] = []
    for row in past_rows:
        desc = row["description"] or ""
        tokens = _description_tokens(desc)
        if tokens:
            past_entries.append({
                "tokens": tokens,
                "description": desc,
                "account_id": int(row["account_id"]),
                "account_name": row["account_name"],
                "amount": float(row["amount"]),
            })

    # ── Step 3: For each group, find matching past transactions ──
    result_groups = []
    grouped_indices = set()

    for gkey, gdata in groups.items():
        group_tokens = gdata["tokens"]
        indices = gdata["indices"]

        # Skip single-transaction groups with only generic tokens
        # (they'll get individual categorization via suggest_account instead)

        # Find similar past transactions
        category_votes: Dict[int, Dict[str, Any]] = {}
        match_count = 0

        for past in past_entries:
            sim = _jaccard_similarity(group_tokens, past["tokens"])
            if sim >= 0.5:
                match_count += 1
                acct_id = past["account_id"]
                if acct_id not in category_votes:
                    category_votes[acct_id] = {
                        "account_id": acct_id,
                        "account_name": past["account_name"],
                        "vote_count": 0,
                        "total_similarity": 0.0,
                    }
                category_votes[acct_id]["vote_count"] += 1
                category_votes[acct_id]["total_similarity"] += sim

        # Also check amount patterns for recurring transactions
        if len(indices) >= 1:
            sample_amount = abs(transactions[indices[0]].get("amount", 0))
            if sample_amount > 0:
                for past in past_entries:
                    past_amount = abs(past["amount"])
                    if past_amount > 0 and abs(past_amount - sample_amount) / sample_amount <= 0.05:
                        # Amount within ±5%
                        acct_id = past["account_id"]
                        if acct_id in category_votes:
                            category_votes[acct_id]["vote_count"] += 1
                            category_votes[acct_id]["total_similarity"] += 0.3  # lower weight for amount match

        # Pick the best category
        suggested_id = None
        suggested_name = None
        confidence = 0.0
        match_reason = ""

        if category_votes:
            # Sort by vote_count descending, then avg similarity
            best = max(
                category_votes.values(),
                key=lambda v: (v["vote_count"], v["total_similarity"] / max(v["vote_count"], 1)),
            )
            total_votes = sum(v["vote_count"] for v in category_votes.values())
            consistency = best["vote_count"] / total_votes if total_votes > 0 else 0

            suggested_id = best["account_id"]
            suggested_name = best["account_name"]

            # Confidence based on: match count, similarity, consistency
            avg_sim = best["total_similarity"] / max(best["vote_count"], 1)
            confidence = min(0.95, 0.3 + (avg_sim * 0.3) + (consistency * 0.2) + (min(best["vote_count"], 10) * 0.02))
            match_reason = f"Similar to {best['vote_count']} previous transactions categorized as {suggested_name}"

        # If no past matches, try the individual categorization engine
        if not suggested_id:
            sample_desc = gdata["sample_description"]
            # Extract a vendor-like name from description (first meaningful word chunk)
            vendor_guess = _extract_vendor(sample_desc)
            acct_id, conf = suggest_account(conn, company_id, sample_desc, vendor_guess)
            if acct_id:
                acct = conn.execute("SELECT name FROM accounts WHERE id=?", (acct_id,)).fetchone()
                suggested_id = acct_id
                suggested_name = acct["name"] if acct else None
                confidence = conf
                match_reason = "Matched by vendor/keyword rules"

        # Only create a group if we have something useful
        if suggested_id or len(indices) > 1:
            result_groups.append({
                "group_key": gkey,
                "sample_description": gdata["sample_description"],
                "transaction_indices": indices,
                "suggested_category_id": suggested_id,
                "suggested_category_name": suggested_name,
                "confidence": round(confidence, 2),
                "match_reason": match_reason,
            })
            grouped_indices.update(indices)

    # ── Step 4: Identify ungrouped transactions ──
    all_indices = set(range(len(transactions)))
    ungrouped = sorted(all_indices - grouped_indices)

    return {
        "groups": result_groups,
        "ungrouped_indices": ungrouped,
    }


def _extract_vendor(description: str) -> str:
    """Extract a vendor-like substring from a transaction description."""
    if not description:
        return ""
    # Take the first meaningful chunk (before common separators)
    parts = re.split(r"[\-–—\*/\\|#]", description)
    vendor = parts[0].strip()
    # Remove trailing numbers/dates
    vendor = re.sub(r"\s*\d{2,}.*$", "", vendor).strip()
    return vendor
