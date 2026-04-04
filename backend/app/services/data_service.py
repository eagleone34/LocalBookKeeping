"""
Core data service – all database operations go through here.
Single-responsibility: translate between Python dicts/models and SQLite rows.
"""
from __future__ import annotations

import os
import sqlite3
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple


def _now() -> str:
    return datetime.utcnow().isoformat()


# ═══════════════════════════════════════════════════════
#  COMPANY
# ═══════════════════════════════════════════════════════

def ensure_company(conn: sqlite3.Connection, name: str = "My Company", currency: str = "USD") -> int:
    row = conn.execute("SELECT id FROM company WHERE name = ?", (name,)).fetchone()
    if row:
        return int(row["id"])
    now = _now()
    cur = conn.execute(
        "INSERT INTO company (name, currency, fiscal_year_start, created_at, updated_at) VALUES (?,?,1,?,?)",
        (name, currency, now, now),
    )
    conn.commit()
    return int(cur.lastrowid)


def get_company(conn: sqlite3.Connection, company_id: int) -> Optional[Dict]:
    row = conn.execute("SELECT * FROM company WHERE id=?", (company_id,)).fetchone()
    return dict(row) if row else None


def update_company(conn: sqlite3.Connection, company_id: int, **kwargs) -> None:
    sets = []
    vals = []
    for k, v in kwargs.items():
        if v is not None:
            sets.append(f"{k}=?")
            vals.append(v)
    if not sets:
        return
    sets.append("updated_at=?")
    vals.append(_now())
    vals.append(company_id)
    conn.execute(f"UPDATE company SET {','.join(sets)} WHERE id=?", vals)
    conn.commit()


# ═══════════════════════════════════════════════════════
#  ACCOUNTS
# ═══════════════════════════════════════════════════════

_ACCOUNT_CODE_BASES = {
    "asset": 1000,
    "liability": 2000,
    "equity": 3000,
    "income": 4000,
    "expense": 5000,
}


def _next_account_code(conn: sqlite3.Connection, company_id: int, acct_type: str) -> str:
    base = _ACCOUNT_CODE_BASES.get(acct_type, 5000)
    range_end = base + 999

    rows = conn.execute(
        "SELECT code FROM accounts WHERE company_id=? AND type=? AND code IS NOT NULL AND code != ''",
        (company_id, acct_type),
    ).fetchall()

    max_code = base - 10
    for row in rows:
        try:
            val = int(row["code"])
            if base <= val <= range_end and val > max_code:
                max_code = val
        except (ValueError, TypeError):
            continue

    return str(max_code + 10)


def list_accounts(conn: sqlite3.Connection, company_id: int, include_inactive: bool = False) -> List[Dict]:
    sql = "SELECT * FROM accounts WHERE company_id=?"
    if not include_inactive:
        sql += " AND is_active=1"
    sql += " ORDER BY type, name"
    return [dict(r) for r in conn.execute(sql, (company_id,)).fetchall()]


def get_account(conn: sqlite3.Connection, account_id: int) -> Optional[Dict]:
    row = conn.execute("SELECT * FROM accounts WHERE id=?", (account_id,)).fetchone()
    return dict(row) if row else None


def create_account(conn: sqlite3.Connection, company_id: int, name: str, acct_type: str,
                   parent_id: Optional[int] = None, code: Optional[str] = None,
                   description: Optional[str] = None, currency: str = "USD") -> int:
    if not code:
        code = _next_account_code(conn, company_id, acct_type)
    now = _now()
    cur = conn.execute(
        """INSERT INTO accounts (company_id, name, type, parent_id, code, description, currency, is_active, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,1,?,?)""",
        (company_id, name, acct_type, parent_id, code, description, currency, now, now),
    )
    conn.commit()
    _audit(conn, company_id, "account", cur.lastrowid, "create", f"Created account '{name}'")
    return int(cur.lastrowid)


def update_account(conn: sqlite3.Connection, account_id: int, **kwargs) -> None:
    sets, vals = [], []
    for k, v in kwargs.items():
        if v is not None:
            sets.append(f"{k}=?")
            vals.append(v)
    if not sets:
        return
    sets.append("updated_at=?")
    vals.append(_now())
    vals.append(account_id)
    conn.execute(f"UPDATE accounts SET {','.join(sets)} WHERE id=?", vals)
    conn.commit()


def archive_account(conn: sqlite3.Connection, account_id: int) -> None:
    conn.execute("UPDATE accounts SET is_active=0, updated_at=? WHERE id=?", (_now(), account_id))
    conn.commit()


def restore_account(conn: sqlite3.Connection, account_id: int) -> None:
    conn.execute("UPDATE accounts SET is_active=1, updated_at=? WHERE id=?", (_now(), account_id))
    conn.commit()


def count_account_transactions(conn: sqlite3.Connection, account_id: int) -> int:
    """Count transactions linked to an account — both directly (category) and via bank_accounts (asset/liability)."""
    row = conn.execute(
        """SELECT COUNT(*) as cnt FROM transactions
           WHERE account_id=?
              OR bank_account_id IN (SELECT id FROM bank_accounts WHERE ledger_account_id=?)""",
        (account_id, account_id),
    ).fetchone()
    return int(row["cnt"])


def delete_account(conn: sqlite3.Connection, account_id: int) -> None:
    # Clean up in FK order: reconciliations -> bank_accounts -> account
    conn.execute(
        "DELETE FROM reconciliations WHERE bank_account_id IN "
        "(SELECT id FROM bank_accounts WHERE ledger_account_id=?)",
        (account_id,),
    )
    conn.execute("DELETE FROM bank_accounts WHERE ledger_account_id=?", (account_id,))
    conn.execute("DELETE FROM accounts WHERE id=?", (account_id,))
    conn.commit()


# ── Account Balance & Ledger ──────────────────────────────────────────────────

def get_account_balance(conn: sqlite3.Connection, company_id: int, account_id: int) -> float:
    """
    Return the current balance of an asset/liability account.
    Balance = opening_balance + SUM of all transaction amounts where bank_account_id links to this ledger account.
    """
    row = conn.execute("""
        SELECT COALESCE(SUM(t.amount), 0) AS balance
        FROM transactions t
        JOIN bank_accounts ba ON t.bank_account_id = ba.id
        WHERE ba.ledger_account_id = ? AND t.company_id = ?
    """, (account_id, company_id)).fetchone()
    balance = float(row["balance"]) if row else 0.0

    ob_row = conn.execute("""
        SELECT COALESCE(SUM(opening_balance), 0) AS ob
        FROM bank_accounts
        WHERE ledger_account_id = ? AND company_id = ?
    """, (account_id, company_id)).fetchone()
    balance += float(ob_row["ob"]) if ob_row else 0.0

    return balance


def get_account_balances_for_company(conn: sqlite3.Connection, company_id: int) -> Dict[int, float]:
    """
    Return a dict of {ledger_account_id: balance} for all bank-linked accounts.
    Includes opening_balance in the total.
    """
    rows = conn.execute("""
        SELECT ba.ledger_account_id,
               COALESCE(SUM(t.amount), 0) + COALESCE(ba.opening_balance, 0) AS balance
        FROM bank_accounts ba
        LEFT JOIN transactions t ON t.bank_account_id = ba.id AND t.company_id = ?
        WHERE ba.company_id = ? AND ba.ledger_account_id IS NOT NULL
        GROUP BY ba.ledger_account_id, ba.opening_balance
    """, (company_id, company_id)).fetchall()
    return {int(r["ledger_account_id"]): float(r["balance"]) for r in rows}


def get_account_ledger(conn: sqlite3.Connection, company_id: int, account_id: int,
                       date_from: Optional[str] = None, date_to: Optional[str] = None) -> List[Dict]:
    """
    Return all transactions for a ledger account (via bank_account link),
    sorted oldest→newest, with a running balance column.
    Includes a synthetic "Opening Balance" row if one is set on the bank account.
    """
    # Look up opening balance from linked bank account
    ob_row = conn.execute("""
        SELECT opening_balance, opening_balance_date, id AS ba_id
        FROM bank_accounts
        WHERE ledger_account_id = ? AND company_id = ?
        LIMIT 1
    """, (account_id, company_id)).fetchone()

    ob_amount = float(ob_row["opening_balance"]) if ob_row and ob_row["opening_balance"] else 0.0
    ob_date = ob_row["opening_balance_date"] if ob_row else None
    ob_ba_id = int(ob_row["ba_id"]) if ob_row else None

    sql = """
        SELECT t.id, t.txn_date, t.amount, t.description, t.source,
               t.is_reconciled, t.reconciliation_id, t.bank_account_id,
               v.name AS vendor_name
        FROM transactions t
        JOIN bank_accounts ba ON t.bank_account_id = ba.id
        LEFT JOIN vendors v ON t.vendor_id = v.id
        WHERE ba.ledger_account_id = ? AND t.company_id = ?
    """
    params: list = [account_id, company_id]
    if date_from:
        sql += " AND t.txn_date >= ?"
        params.append(date_from)
    if date_to:
        sql += " AND t.txn_date <= ?"
        params.append(date_to)
    sql += " ORDER BY t.txn_date ASC, t.id ASC"

    rows = [dict(r) for r in conn.execute(sql, params).fetchall()]

    # Determine whether to show the opening balance row or use it as a starting value
    show_ob_row = False
    running = 0.0

    if ob_amount != 0 and ob_date:
        ob_in_range = True
        if date_from and ob_date < date_from:
            ob_in_range = False
        if date_to and ob_date > date_to:
            ob_in_range = False

        if ob_in_range:
            # Prepend synthetic opening balance row
            show_ob_row = True
            ob_entry = {
                "id": 0,
                "txn_date": ob_date,
                "amount": ob_amount,
                "description": "Opening Balance",
                "source": "opening_balance",
                "is_reconciled": 1,
                "reconciliation_id": None,
                "bank_account_id": ob_ba_id,
                "vendor_name": None,
            }
            rows.insert(0, ob_entry)
            running = 0.0  # Will accumulate from the OB row itself
        else:
            # OB date is outside filter range — use it as starting balance
            if not date_from or ob_date < date_from:
                running = ob_amount

    # Compute running balance
    for r in rows:
        running += r["amount"]
        r["running_balance"] = round(running, 2)

    return rows


def get_min_txn_date(conn: sqlite3.Connection, company_id: int, bank_account_id: int) -> Optional[str]:
    """Return the earliest transaction date for a bank account, or None if no transactions."""
    row = conn.execute(
        "SELECT MIN(txn_date) AS earliest FROM transactions WHERE company_id=? AND bank_account_id=?",
        (company_id, bank_account_id),
    ).fetchone()
    return row["earliest"] if row and row["earliest"] else None


def validate_opening_balance_date(conn: sqlite3.Connection, company_id: int,
                                   bank_account_id: int, date: str) -> Tuple[bool, Optional[str]]:
    """
    Validate that the opening balance date is before any existing transactions.
    Returns (is_valid, error_message).
    """
    earliest = get_min_txn_date(conn, company_id, bank_account_id)
    if earliest and date >= earliest:
        return False, f"Opening balance date must be before the earliest transaction ({earliest})"
    return True, None


# ═══════════════════════════════════════════════════════
#  VENDORS
# ═══════════════════════════════════════════════════════

def upsert_vendor(conn: sqlite3.Connection, company_id: int, name: str) -> int:
    if not name or not name.strip():
        return 0
    name = name.strip()
    row = conn.execute("SELECT id FROM vendors WHERE company_id=? AND name=?", (company_id, name)).fetchone()
    if row:
        return int(row["id"])
    cur = conn.execute("INSERT INTO vendors (company_id, name, created_at) VALUES (?,?,?)",
                       (company_id, name, _now()))
    conn.commit()
    return int(cur.lastrowid)


def list_vendors(conn: sqlite3.Connection, company_id: int) -> List[Dict]:
    return [dict(r) for r in conn.execute(
        "SELECT * FROM vendors WHERE company_id=? ORDER BY name", (company_id,)).fetchall()]


# ═══════════════════════════════════════════════════════
#  TRANSACTIONS
# ═══════════════════════════════════════════════════════

def list_transactions(conn: sqlite3.Connection, company_id: int,
                      account_id: Optional[int] = None,
                      category_id: Optional[int] = None,
                      category_type: Optional[str] = None,
                      vendor_id: Optional[int] = None,
                      bank_account_id: Optional[int] = None,
                      search: Optional[str] = None,
                      date_from: Optional[str] = None,
                      date_to: Optional[str] = None,
                      limit: int = 500, offset: int = 0) -> List[Dict]:
    sql = """
        SELECT t.*, a.name AS account_name, a.type AS account_type,
               v.name AS vendor_name, ba.bank_name AS bank_account_name
        FROM transactions t
        JOIN accounts a ON t.account_id = a.id
        LEFT JOIN vendors v ON t.vendor_id = v.id
        LEFT JOIN bank_accounts ba ON t.bank_account_id = ba.id
        WHERE t.company_id = ?
    """
    params: list = [company_id]
    filter_account_id = category_id if category_id else account_id
    if filter_account_id:
        sql += " AND t.account_id=?"
        params.append(filter_account_id)
    if category_type:
        sql += " AND a.type = ?"
        params.append(category_type)
    if vendor_id:
        sql += " AND t.vendor_id=?"
        params.append(vendor_id)
    if bank_account_id:
        sql += " AND t.bank_account_id=?"
        params.append(bank_account_id)
    if search:
        sql += " AND (t.description LIKE ? OR v.name LIKE ? OR t.memo LIKE ? OR a.name LIKE ?)"
        like = f"%{search}%"
        params.extend([like, like, like, like])
    if date_from:
        sql += " AND t.txn_date>=?"
        params.append(date_from)
    if date_to:
        sql += " AND t.txn_date<=?"
        params.append(date_to)
    sql += " ORDER BY t.txn_date DESC, t.id DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def count_transactions(conn: sqlite3.Connection, company_id: int) -> int:
    row = conn.execute("SELECT COUNT(*) as cnt FROM transactions WHERE company_id=?", (company_id,)).fetchone()
    return int(row["cnt"])


def create_transaction(conn: sqlite3.Connection, company_id: int,
                       account_id: int, txn_date: str, amount: float,
                       description: str = "", memo: str = "",
                       vendor_name: str = "", source: str = "manual",
                       source_doc_id: Optional[int] = None,
                       bank_account_id: Optional[int] = None) -> int:
    vendor_id = upsert_vendor(conn, company_id, vendor_name) if vendor_name else None
    now = _now()
    cur = conn.execute(
        """INSERT INTO transactions
           (company_id, account_id, vendor_id, txn_date, description, memo, amount, is_posted, source, source_doc_id, bank_account_id, is_reconciled, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,1,?,?,?,0,?,?)""",
        (company_id, account_id, vendor_id, txn_date, description, memo, amount, source, source_doc_id, bank_account_id, now, now),
    )
    conn.commit()
    if vendor_name:
        _update_vendor_account_map(conn, company_id, vendor_name, account_id)
    return int(cur.lastrowid)


def update_transaction(conn: sqlite3.Connection, company_id: int, txn_id: int, **kwargs) -> None:
    vendor_name = kwargs.pop("vendor_name", None)
    if vendor_name is not None:
        vid = upsert_vendor(conn, company_id, vendor_name) if vendor_name else None
        kwargs["vendor_id"] = vid
    sets, vals = [], []
    for k, v in kwargs.items():
        if v is not None:
            sets.append(f"{k}=?")
            vals.append(v)
    if not sets:
        return
    sets.append("updated_at=?")
    vals.append(_now())
    vals.append(txn_id)
    conn.execute(f"UPDATE transactions SET {','.join(sets)} WHERE id=?", vals)
    conn.commit()


def delete_transaction(conn: sqlite3.Connection, txn_id: int) -> None:
    conn.execute("DELETE FROM transactions WHERE id=?", (txn_id,))
    conn.commit()


def bulk_recategorize(conn: sqlite3.Connection, txn_ids: List[int], account_id: int) -> int:
    if not txn_ids:
        return 0
    placeholders = ",".join("?" * len(txn_ids))
    conn.execute(
        f"UPDATE transactions SET account_id=?, updated_at=? WHERE id IN ({placeholders})",
        [account_id, _now()] + txn_ids,
    )
    conn.commit()
    return len(txn_ids)


# ═══════════════════════════════════════════════════════
#  BUDGETS
# ═══════════════════════════════════════════════════════

def list_budgets(conn: sqlite3.Connection, company_id: int,
                 month: Optional[str] = None) -> List[Dict]:
    sql = """
        SELECT b.*, a.name AS account_name, a.type AS account_type
        FROM budgets b
        JOIN accounts a ON b.account_id = a.id
        WHERE b.company_id=?
    """
    params: list = [company_id]
    if month:
        sql += " AND b.month=?"
        params.append(month)
    sql += " ORDER BY b.month DESC, a.name"
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def upsert_budget(conn: sqlite3.Connection, company_id: int,
                  account_id: int, month: str, amount: float, notes: str = "") -> int:
    now = _now()
    conn.execute(
        """INSERT INTO budgets (company_id, account_id, month, amount, notes, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(company_id, account_id, month)
           DO UPDATE SET amount=excluded.amount, notes=excluded.notes, updated_at=excluded.updated_at""",
        (company_id, account_id, month, amount, notes, now, now),
    )
    conn.commit()
    row = conn.execute("SELECT id FROM budgets WHERE company_id=? AND account_id=? AND month=?",
                       (company_id, account_id, month)).fetchone()
    return int(row["id"]) if row else 0


def delete_budget(conn: sqlite3.Connection, budget_id: int) -> None:
    conn.execute("DELETE FROM budgets WHERE id=?", (budget_id,))
    conn.commit()


# ═══════════════════════════════════════════════════════
#  DOCUMENTS
# ═══════════════════════════════════════════════════════

def create_document(conn: sqlite3.Connection, company_id: int,
                    filename: str, file_path: str, file_size: int = 0) -> int:
    now = _now()
    cur = conn.execute(
        """INSERT INTO documents (company_id, filename, file_path, file_size, status, imported_at)
           VALUES (?,?,?,?,'pending',?)""",
        (company_id, filename, file_path, file_size, now),
    )
    conn.commit()
    return int(cur.lastrowid)


def update_document(conn: sqlite3.Connection, doc_id: int, **kwargs) -> None:
    sets, vals = [], []
    for k, v in kwargs.items():
        if v is not None:
            sets.append(f"{k}=?")
            vals.append(v)
    if not sets:
        return
    vals.append(doc_id)
    conn.execute(f"UPDATE documents SET {','.join(sets)} WHERE id=?", vals)
    conn.commit()


def list_documents(conn: sqlite3.Connection, company_id: int) -> List[Dict]:
    return [dict(r) for r in conn.execute(
        "SELECT * FROM documents WHERE company_id=? ORDER BY imported_at DESC",
        (company_id,)).fetchall()]


def delete_document(conn: sqlite3.Connection, doc_id: int) -> None:
    doc = conn.execute("SELECT file_path FROM documents WHERE id=?", (doc_id,)).fetchone()
    if not doc:
        return

    file_path = doc["file_path"]

    try:
        conn.execute("DELETE FROM document_transactions WHERE document_id=?", (doc_id,))
        conn.execute("DELETE FROM transactions WHERE source_doc_id=?", (doc_id,))
        conn.execute("DELETE FROM documents WHERE id=?", (doc_id,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    if file_path and file_path != "csv_import":
        try:
            os.remove(file_path)
        except (FileNotFoundError, OSError):
            pass


def delete_doc_transaction(conn: sqlite3.Connection, dt_id: int) -> None:
    conn.execute("DELETE FROM document_transactions WHERE id=?", (dt_id,))
    conn.commit()


def create_doc_transaction(conn: sqlite3.Connection, doc_id: int,
                           txn_date: str, description: str, amount: float,
                           vendor_name: str, suggested_account_id: Optional[int],
                           confidence: float, bank_account_id: Optional[int] = None,
                           category_id: Optional[int] = None) -> int:
    now = _now()
    cur = conn.execute(
        """INSERT INTO document_transactions
           (document_id, txn_date, description, amount, vendor_name, suggested_account_id, confidence, status, created_at, bank_account_id, category_id)
           VALUES (?,?,?,?,?,?,?,'review',?,?,?)""",
        (doc_id, txn_date, description, amount, vendor_name, suggested_account_id, confidence, now, bank_account_id, category_id),
    )
    conn.commit()
    return int(cur.lastrowid)


def list_doc_transactions(conn: sqlite3.Connection, doc_id: Optional[int] = None,
                          status: Optional[str] = None,
                          company_id: Optional[int] = None) -> List[Dict]:
    sql = """
        SELECT dt.*,
               a1.name AS suggested_account_name,
               a2.name AS user_account_name,
               ac.name AS category_name,
               ba.bank_name AS bank_account_name,
               ba.last_four AS bank_account_last_four
        FROM document_transactions dt
        JOIN documents d ON dt.document_id = d.id
        LEFT JOIN accounts a1 ON dt.suggested_account_id = a1.id
        LEFT JOIN accounts a2 ON dt.user_account_id = a2.id
        LEFT JOIN accounts ac ON dt.category_id = ac.id
        LEFT JOIN bank_accounts ba ON dt.bank_account_id = ba.id
        WHERE 1=1
    """
    params: list = []
    if company_id:
        sql += " AND d.company_id=?"
        params.append(company_id)
    if doc_id:
        sql += " AND dt.document_id=?"
        params.append(doc_id)
    if status:
        if status == "duplicate":
            sql += " AND dt.is_duplicate=1"
        else:
            sql += " AND dt.status=?"
            params.append(status)
    sql += " ORDER BY dt.txn_date DESC, dt.id DESC"
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def update_doc_transaction(conn: sqlite3.Connection, dt_id: int, **kwargs) -> None:
    sets, vals = [], []
    for k, v in kwargs.items():
        sets.append(f"{k}=?")
        vals.append(v)
    if not sets:
        return
    vals.append(dt_id)
    conn.execute(f"UPDATE document_transactions SET {','.join(sets)} WHERE id=?", vals)
    conn.commit()


def get_doc_transaction(conn: sqlite3.Connection, dt_id: int) -> Optional[Dict]:
    row = conn.execute("SELECT * FROM document_transactions WHERE id=?", (dt_id,)).fetchone()
    return dict(row) if row else None


def count_pending_review(conn: sqlite3.Connection, company_id: int) -> int:
    row = conn.execute("""
        SELECT COUNT(*) as cnt FROM document_transactions dt
        JOIN documents d ON dt.document_id = d.id
        WHERE d.company_id=? AND dt.status='review'
    """, (company_id,)).fetchone()
    return int(row["cnt"])


# ═══════════════════════════════════════════════════════
#  CATEGORIZATION RULES
# ═══════════════════════════════════════════════════════

def list_rules(conn: sqlite3.Connection, company_id: int) -> List[Dict]:
    sql = """
        SELECT r.*, a.name AS account_name
        FROM categorization_rules r
        JOIN accounts a ON r.account_id = a.id
        WHERE r.company_id=?
        ORDER BY r.priority
    """
    return [dict(r) for r in conn.execute(sql, (company_id,)).fetchall()]


def create_rule(conn: sqlite3.Connection, company_id: int,
                pattern: str, match_type: str, account_id: int, priority: int = 10) -> int:
    now = _now()
    cur = conn.execute(
        """INSERT INTO categorization_rules (company_id, pattern, match_type, account_id, priority, is_active, created_at)
           VALUES (?,?,?,?,?,1,?)""",
        (company_id, pattern, match_type, account_id, priority, now),
    )
    conn.commit()
    return int(cur.lastrowid)


def delete_rule(conn: sqlite3.Connection, rule_id: int) -> None:
    conn.execute("DELETE FROM categorization_rules WHERE id=?", (rule_id,))
    conn.commit()


# ═══════════════════════════════════════════════════════
#  VENDOR-ACCOUNT MAP
# ═══════════════════════════════════════════════════════

def _update_vendor_account_map(conn: sqlite3.Connection, company_id: int,
                               vendor_name: str, account_id: int) -> None:
    now = _now()
    conn.execute(
        """INSERT INTO vendor_account_map (company_id, vendor_name, account_id, hit_count, last_used)
           VALUES (?,?,?,1,?)
           ON CONFLICT(company_id, vendor_name)
           DO UPDATE SET account_id=excluded.account_id, hit_count=hit_count+1, last_used=excluded.last_used""",
        (company_id, vendor_name, account_id, now),
    )
    conn.commit()


def get_vendor_account_suggestion(conn: sqlite3.Connection, company_id: int,
                                  vendor_name: str) -> Optional[Tuple[int, float]]:
    row = conn.execute(
        "SELECT account_id, hit_count FROM vendor_account_map WHERE company_id=? AND vendor_name=?",
        (company_id, vendor_name),
    ).fetchone()
    if row:
        confidence = min(0.95, 0.6 + (int(row["hit_count"]) * 0.05))
        return int(row["account_id"]), confidence
    return None


# ═══════════════════════════════════════════════════════
#  REPORTS
# ═══════════════════════════════════════════════════════

def profit_and_loss(conn: sqlite3.Connection, company_id: int,
                    date_from: Optional[str] = None, date_to: Optional[str] = None,
                    bank_account_id: Optional[int] = None) -> List[Dict]:
    sql = """
        SELECT a.type, strftime('%Y-%m', t.txn_date) AS month, SUM(t.amount) AS total
        FROM transactions t
        JOIN accounts a ON t.account_id = a.id
        WHERE t.company_id=? AND a.type IN ('income','expense')
    """
    params: list = [company_id]
    if date_from:
        sql += " AND t.txn_date>=?"
        params.append(date_from)
    if date_to:
        sql += " AND t.txn_date<=?"
        params.append(date_to)
    if bank_account_id:
        sql += " AND t.bank_account_id=?"
        params.append(bank_account_id)
    sql += " GROUP BY a.type, month ORDER BY month, a.type"
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def budget_vs_actual(conn: sqlite3.Connection, company_id: int,
                     month_from: Optional[str] = None,
                     month_to: Optional[str] = None,
                     account_id: Optional[int] = None) -> List[Dict]:
    budget_sql = """
        WITH budget_totals AS (
            SELECT account_id,
                   SUM(amount) AS budgeted,
                   COUNT(DISTINCT month) AS budget_month_count
            FROM budgets
            WHERE company_id=?
    """
    params: list = [company_id]
    if month_from:
        budget_sql += " AND month >= ?"
        params.append(month_from)
    if month_to:
        budget_sql += " AND month <= ?"
        params.append(month_to)
    if account_id:
        budget_sql += " AND account_id = ?"
        params.append(account_id)
    budget_sql += "\n            GROUP BY account_id\n        ),"

    actual_sql = """
        actual_totals AS (
            SELECT account_id,
                   SUM(ABS(amount)) AS actual_amount,
                   COUNT(DISTINCT strftime('%Y-%m', txn_date)) AS actual_month_count
            FROM transactions
            WHERE company_id=?
    """
    params.append(company_id)
    if month_from:
        actual_sql += " AND strftime('%Y-%m', txn_date) >= ?"
        params.append(month_from)
    if month_to:
        actual_sql += " AND strftime('%Y-%m', txn_date) <= ?"
        params.append(month_to)
    if account_id:
        actual_sql += " AND account_id = ?"
        params.append(account_id)
    actual_sql += "\n            GROUP BY account_id\n        )"

    final_sql = """
        SELECT bt.account_id,
               a.name  AS account_name,
               a.type  AS account_type,
               bt.budgeted,
               COALESCE(at.actual_amount, 0) AS actual,
               bt.budget_month_count,
               bt.budgeted * 1.0 / bt.budget_month_count AS monthly_budget,
               COALESCE(at.actual_amount, 0) * 1.0 / CASE WHEN COALESCE(at.actual_month_count, 0) = 0 THEN 1 ELSE at.actual_month_count END AS monthly_actual,
               COALESCE(at.actual_month_count, 0) AS actual_month_count,
               (bt.budgeted * 1.0 / bt.budget_month_count)
                 - (COALESCE(at.actual_amount, 0) * 1.0 / CASE WHEN COALESCE(at.actual_month_count, 0) = 0 THEN 1 ELSE at.actual_month_count END)
                 AS variance
        FROM budget_totals bt
        JOIN accounts a ON bt.account_id = a.id
        LEFT JOIN actual_totals at ON at.account_id = bt.account_id
        ORDER BY a.name
    """

    sql = budget_sql + actual_sql + final_sql
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def budget_summary_by_period(
    conn: sqlite3.Connection,
    company_id: int,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    account_id: Optional[int] = None,
) -> List[Dict]:
    from datetime import date as _date

    num_months: float = 1.0
    if start_date and end_date:
        try:
            s = _date.fromisoformat(start_date)
            e = _date.fromisoformat(end_date)
            computed = (e.year - s.year) * 12 + (e.month - s.month) + 1
            num_months = float(max(1, computed))
        except (ValueError, TypeError):
            num_months = 1.0
    else:
        earliest_row = conn.execute(
            "SELECT MIN(txn_date) AS earliest FROM transactions WHERE company_id=?",
            (company_id,),
        ).fetchone()
        earliest_val = earliest_row["earliest"] if earliest_row else None
        if earliest_val:
            try:
                e_dt  = _date.fromisoformat(earliest_val[:10])
                today = _date.today()
                computed = (today.year - e_dt.year) * 12 + (today.month - e_dt.month) + 1
                num_months = float(max(1, computed))
            except (ValueError, TypeError):
                num_months = 1.0

    budget_params: list = [company_id, company_id]
    actual_params: list = [company_id]
    final_params: list = [company_id]

    budget_acct_filter = ""
    actual_acct_filter = ""
    final_acct_filter = ""

    if account_id:
        budget_acct_filter = " AND b.account_id = ?"
        budget_params.append(account_id)
        actual_acct_filter = " AND t.account_id = ?"
        actual_params.append(account_id)
        final_acct_filter = " AND a.id = ?"
        final_params.append(account_id)

    date_filter = ""
    if start_date:
        date_filter += " AND t.txn_date >= ?"
        actual_params.append(start_date)
    if end_date:
        date_filter += " AND t.txn_date <= ?"
        actual_params.append(end_date)

    sql = f"""
        WITH
        user_budgets AS (
            SELECT b.account_id,
                   b.amount AS user_budget
            FROM   budgets b
            WHERE  b.company_id = ?
              AND  b.month = (
                  SELECT MAX(b2.month)
                  FROM   budgets b2
                  WHERE  b2.company_id = ?
                    AND  b2.account_id = b.account_id
              ){budget_acct_filter}
        ),
        period_actuals AS (
            SELECT t.account_id,
                   SUM(ABS(t.amount)) AS total_spend
            FROM   transactions t
            JOIN   accounts a ON t.account_id = a.id
            WHERE  t.company_id = ?
              AND  a.type       = 'expense'{date_filter}{actual_acct_filter}
            GROUP BY t.account_id
        )
        SELECT
            a.id                                     AS account_id,
            a.name                                   AS account_name,
            COALESCE(ub.user_budget,  0)             AS user_budget,
            COALESCE(pa.total_spend, 0) / ?          AS actual,
            COALESCE(ub.user_budget,  0)
              - COALESCE(pa.total_spend, 0) / ?      AS variance
        FROM   accounts a
        LEFT JOIN user_budgets   ub ON ub.account_id = a.id
        LEFT JOIN period_actuals pa ON pa.account_id = a.id
        WHERE  a.company_id = ?
          AND  a.type       = 'expense'
          AND  a.is_active  = 1
          AND  ub.account_id IS NOT NULL{final_acct_filter}
        ORDER BY a.name
    """

    all_params = (
        budget_params
        + actual_params
        + [num_months, num_months]
        + final_params
    )

    return [dict(r) for r in conn.execute(sql, all_params).fetchall()]


def expense_by_category(conn: sqlite3.Connection, company_id: int,
                        date_from: Optional[str] = None, date_to: Optional[str] = None,
                        bank_account_id: Optional[int] = None) -> List[Dict]:
    sql = """
        SELECT a.id AS account_id, a.name AS account_name, SUM(ABS(t.amount)) AS total
        FROM transactions t
        JOIN accounts a ON t.account_id = a.id
        WHERE t.company_id=? AND a.type='expense'
    """
    params: list = [company_id]
    if date_from:
        sql += " AND t.txn_date>=?"
        params.append(date_from)
    if date_to:
        sql += " AND t.txn_date<=?"
        params.append(date_to)
    if bank_account_id:
        sql += " AND t.bank_account_id=?"
        params.append(bank_account_id)
    sql += " GROUP BY a.id, a.name ORDER BY total DESC"
    rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
    grand = sum(r["total"] for r in rows) or 1
    for r in rows:
        r["percentage"] = round(r["total"] / grand * 100, 1)
    return rows


def expense_by_vendor(conn: sqlite3.Connection, company_id: int,
                      date_from: Optional[str] = None, date_to: Optional[str] = None,
                      bank_account_id: Optional[int] = None) -> List[Dict]:
    sql = """
        SELECT COALESCE(v.name, 'Unknown') AS vendor_name, SUM(ABS(t.amount)) AS total
        FROM transactions t
        LEFT JOIN vendors v ON t.vendor_id = v.id
        JOIN accounts a ON t.account_id = a.id
        WHERE t.company_id=? AND a.type='expense'
    """
    params: list = [company_id]
    if date_from:
        sql += " AND t.txn_date>=?"
        params.append(date_from)
    if date_to:
        sql += " AND t.txn_date<=?"
        params.append(date_to)
    if bank_account_id:
        sql += " AND t.bank_account_id=?"
        params.append(bank_account_id)
    sql += " GROUP BY vendor_name ORDER BY total DESC"
    rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
    grand = sum(r["total"] for r in rows) or 1
    for r in rows:
        r["percentage"] = round(r["total"] / grand * 100, 1)
    return rows


def monthly_trend(conn: sqlite3.Connection, company_id: int, months: int = 12, bank_account_id: Optional[int] = None) -> List[Dict]:
    sql = """
        SELECT strftime('%Y-%m', t.txn_date) AS month,
               SUM(CASE WHEN a.type='income' THEN t.amount ELSE 0 END) AS income,
               SUM(CASE WHEN a.type='expense' THEN ABS(t.amount) ELSE 0 END) AS expenses
        FROM transactions t
        JOIN accounts a ON t.account_id = a.id
        WHERE t.company_id=? AND a.type IN ('income','expense')
    """
    params: list = [company_id]
    if bank_account_id:
        sql += " AND t.bank_account_id=?"
        params.append(bank_account_id)
    sql += """
        GROUP BY month
        ORDER BY month DESC
        LIMIT ?
    """
    params.append(months)
    rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
    for r in rows:
        r["net"] = r["income"] - r["expenses"]
    rows.reverse()
    return rows


def balance_sheet(conn: sqlite3.Connection, company_id: int) -> List[Dict]:
    rows = []
    seen_account_ids = set()

    bank_balances = conn.execute("""
        SELECT a.id AS account_id, a.type, a.name AS account_name,
               COALESCE(SUM(t.amount), 0) + COALESCE(ba.opening_balance, 0) AS balance
        FROM bank_accounts ba
        JOIN accounts a ON ba.ledger_account_id = a.id
        LEFT JOIN transactions t ON t.bank_account_id = ba.id AND t.company_id = ?
        WHERE ba.company_id = ? AND a.type IN ('asset', 'liability')
        GROUP BY a.id, a.type, a.name, ba.opening_balance
        ORDER BY a.type, a.name
    """, (company_id, company_id)).fetchall()

    for r in bank_balances:
        r = dict(r)
        seen_account_ids.add(r.pop("account_id"))
        rows.append(r)

    direct_balances = conn.execute("""
        SELECT a.id AS account_id, a.type, a.name AS account_name, SUM(t.amount) AS balance
        FROM transactions t
        JOIN accounts a ON t.account_id = a.id
        WHERE t.company_id = ? AND a.type IN ('asset', 'liability', 'equity')
        GROUP BY a.id, a.type, a.name
        ORDER BY a.type, a.name
    """, (company_id,)).fetchall()

    for r in direct_balances:
        r = dict(r)
        acct_id = r.pop("account_id")
        if acct_id in seen_account_ids:
            for existing in rows:
                if existing["account_name"] == r["account_name"] and existing["type"] == r["type"]:
                    existing["balance"] = round(existing["balance"] + r["balance"], 2)
                    break
        else:
            seen_account_ids.add(acct_id)
            rows.append(r)

    for r in rows:
        r["balance"] = round(r["balance"], 2)

    net = conn.execute("""
        SELECT
            COALESCE(SUM(CASE WHEN a.type='income'  THEN t.amount ELSE 0 END), 0) AS total_income,
            COALESCE(SUM(CASE WHEN a.type='expense' THEN t.amount ELSE 0 END), 0) AS total_expense
        FROM transactions t
        JOIN accounts a ON t.account_id = a.id
        WHERE t.company_id=?
    """, (company_id,)).fetchone()

    if net:
        retained = float(net["total_income"]) + float(net["total_expense"])
        if retained != 0:
            rows.append({
                "type": "equity",
                "account_name": "Retained Earnings (Net Income)",
                "balance": round(retained, 2),
            })

    total_assets = sum(r["balance"] for r in rows if r["type"] == "asset")
    total_liabilities = sum(r["balance"] for r in rows if r["type"] == "liability")
    total_equity = sum(r["balance"] for r in rows if r["type"] == "equity")

    balance_check = total_assets - (total_liabilities + total_equity)

    import logging
    logger = logging.getLogger(__name__)

    if abs(balance_check) >= 0.01:
        logger.warning(
            f"BALANCE SHEET IMBALANCE: Assets (${total_assets:,.2f}) != "
            f"Liabilities (${total_liabilities:,.2f}) + Equity (${total_equity:,.2f}). "
            f"Difference: ${balance_check:,.2f}"
        )

    return rows


def summary_totals(conn: sqlite3.Connection, company_id: int,
                   date_from: Optional[str] = None, date_to: Optional[str] = None) -> Dict[str, float]:
    sql = """
        SELECT a.type, SUM(t.amount) AS total
        FROM transactions t
        JOIN accounts a ON t.account_id = a.id
        WHERE t.company_id=?
    """
    params: list = [company_id]
    if date_from:
        sql += " AND t.txn_date>=?"
        params.append(date_from)
    if date_to:
        sql += " AND t.txn_date<=?"
        params.append(date_to)
    sql += " GROUP BY a.type"
    totals = {"income": 0, "expense": 0, "asset": 0, "liability": 0}
    for r in conn.execute(sql, params).fetchall():
        totals[r["type"]] = float(r["total"])
    return totals


# ═══════════════════════════════════════════════════════
#  AUDIT LOG
# ═══════════════════════════════════════════════════════

def _audit(conn: sqlite3.Connection, company_id: int, entity_type: str,
           entity_id: int, action: str, details: str = "") -> None:
    conn.execute(
        "INSERT INTO audit_log (company_id, entity_type, entity_id, action, details, created_at) VALUES (?,?,?,?,?,?)",
        (company_id, entity_type, entity_id, action, details, _now()),
    )
    conn.commit()


# ═══════════════════════════════════════════════════════
#  BANK ACCOUNTS
# ═══════════════════════════════════════════════════════

def upsert_bank_account(conn: sqlite3.Connection, company_id: int,
                        bank_name: str, last_four: str,
                        full_number: str = "", nickname: str = "",
                        ledger_account_id: Optional[int] = None) -> int:
    if not bank_name or not last_four:
        return 0
    now = _now()
    row = conn.execute(
        "SELECT id, ledger_account_id FROM bank_accounts WHERE company_id=? AND bank_name=? AND last_four=?",
        (company_id, bank_name, last_four),
    ).fetchone()
    if row:
        if ledger_account_id and not row["ledger_account_id"]:
            conn.execute(
                "UPDATE bank_accounts SET ledger_account_id=?, updated_at=? WHERE id=?",
                (ledger_account_id, now, row["id"]),
            )
            conn.commit()
        return int(row["id"])
    cur = conn.execute(
        """INSERT INTO bank_accounts (company_id, bank_name, last_four, full_number, nickname, ledger_account_id, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?)""",
        (company_id, bank_name, last_four, full_number, nickname, ledger_account_id, now, now),
    )
    conn.commit()
    return int(cur.lastrowid)


def get_bank_account(conn: sqlite3.Connection, bank_account_id: int) -> Optional[Dict]:
    row = conn.execute("SELECT * FROM bank_accounts WHERE id=?", (bank_account_id,)).fetchone()
    return dict(row) if row else None


def list_bank_accounts(conn: sqlite3.Connection, company_id: int) -> List[Dict]:
    return [dict(r) for r in conn.execute(
        "SELECT ba.*, a.name AS ledger_account_name FROM bank_accounts ba LEFT JOIN accounts a ON ba.ledger_account_id = a.id WHERE ba.company_id=? ORDER BY ba.bank_name, ba.last_four",
        (company_id,),
    ).fetchall()]


def ensure_bank_ledger_account(conn: sqlite3.Connection, bank_account_id: int) -> int:
    ba = get_bank_account(conn, bank_account_id)
    if not ba:
        return 0
    if ba.get("ledger_account_id"):
        return int(ba["ledger_account_id"])

    company_id = ba["company_id"]
    name = f"{ba['bank_name']} - {ba['last_four']}"
    acct_type = "asset"

    existing = conn.execute(
        "SELECT id FROM accounts WHERE company_id=? AND name=? AND type=?",
        (company_id, name, acct_type)
    ).fetchone()

    if existing:
        ledger_id = int(existing["id"])
    else:
        ledger_id = create_account(conn, company_id, name, acct_type)

    update_bank_account(conn, bank_account_id, ledger_account_id=ledger_id)
    return ledger_id


def get_or_create_bank_for_ledger(conn: sqlite3.Connection, company_id: int, ledger_account_id: int) -> int:
    row = conn.execute("SELECT id FROM bank_accounts WHERE company_id=? AND ledger_account_id=?", (company_id, ledger_account_id)).fetchone()
    if row:
        return int(row["id"])

    acct = conn.execute("SELECT name FROM accounts WHERE id=?", (ledger_account_id,)).fetchone()
    bank_name = acct["name"] if acct else f"Account {ledger_account_id}"

    now = _now()
    cur = conn.execute(
        """INSERT INTO bank_accounts (company_id, bank_name, last_four, full_number, nickname, ledger_account_id, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?)""",
        (company_id, bank_name, "", "", "", ledger_account_id, now, now),
    )
    conn.commit()
    return int(cur.lastrowid)


def update_bank_account(conn: sqlite3.Connection, bank_account_id: int, **kwargs) -> None:
    sets, vals = [], []
    for k, v in kwargs.items():
        # Allow clearing opening_balance_date by sending empty string → NULL
        if k == "opening_balance_date" and v == "":
            v = None
        if v is not None:
            sets.append(f"{k}=?")
            vals.append(v)
        elif k == "opening_balance_date":
            # Explicitly set to NULL when clearing
            sets.append(f"{k}=NULL")
    if not sets:
        return
    sets.append("updated_at=?")
    vals.append(_now())
    vals.append(bank_account_id)
    conn.execute(f"UPDATE bank_accounts SET {','.join(sets)} WHERE id=?", vals)
    conn.commit()


def find_bank_account_by_last_four(conn: sqlite3.Connection, company_id: int,
                                    bank_name: str, last_four: str) -> Optional[Dict]:
    row = conn.execute(
        "SELECT ba.*, a.name AS ledger_account_name FROM bank_accounts ba LEFT JOIN accounts a ON ba.ledger_account_id = a.id WHERE ba.company_id=? AND ba.bank_name=? AND ba.last_four=?",
        (company_id, bank_name, last_four),
    ).fetchone()
    return dict(row) if row else None


# ═══════════════════════════════════════════════════════
#  RECONCILIATION
# ═══════════════════════════════════════════════════════

def get_last_reconciliation(conn: sqlite3.Connection, company_id: int, bank_account_id: int) -> Optional[Dict]:
    """Return the most recent reconciliation for a bank account."""
    row = conn.execute("""
        SELECT * FROM reconciliations
        WHERE company_id=? AND bank_account_id=?
        ORDER BY reconciled_date DESC, id DESC
        LIMIT 1
    """, (company_id, bank_account_id)).fetchone()
    return dict(row) if row else None


def get_reconciliation_status(conn: sqlite3.Connection, company_id: int, bank_account_id: int) -> Dict:
    """
    Return reconciliation status for a bank account:
    - last reconciled date & balance
    - current LocalBooks balance
    - list of unreconciled transactions
    """
    ba = get_bank_account(conn, bank_account_id)
    if not ba:
        return {}

    last_rec = get_last_reconciliation(conn, company_id, bank_account_id)

    # Current balance (all transactions + opening balance)
    balance_row = conn.execute("""
        SELECT COALESCE(SUM(amount), 0) AS balance
        FROM transactions
        WHERE company_id=? AND bank_account_id=?
    """, (company_id, bank_account_id)).fetchone()
    current_balance = float(balance_row["balance"]) if balance_row else 0.0
    current_balance += float(ba["opening_balance"]) if ba.get("opening_balance") else 0.0

    # Unreconciled transactions
    unrec_rows = conn.execute("""
        SELECT t.id, t.txn_date, t.amount, t.description, t.source,
               t.is_reconciled, t.reconciliation_id, t.bank_account_id,
               v.name AS vendor_name
        FROM transactions t
        LEFT JOIN vendors v ON t.vendor_id = v.id
        WHERE t.company_id=? AND t.bank_account_id=? AND t.is_reconciled=0
        ORDER BY t.txn_date ASC, t.id ASC
    """, (company_id, bank_account_id)).fetchall()

    # Compute running balance for unreconciled txns starting from last reconciled balance
    if last_rec:
        start_balance = float(last_rec["localbooks_balance"])
    else:
        start_balance = float(ba["opening_balance"]) if ba.get("opening_balance") else 0.0
    running = start_balance
    unreconciled = []
    for r in unrec_rows:
        row_dict = dict(r)
        running += row_dict["amount"]
        row_dict["running_balance"] = round(running, 2)
        unreconciled.append(row_dict)

    return {
        "bank_account_id": bank_account_id,
        "bank_name": ba["bank_name"],
        "last_four": ba["last_four"],
        "last_reconciled_date": last_rec["reconciled_date"] if last_rec else None,
        "last_reconciled_balance": float(last_rec["statement_balance"]) if last_rec else None,
        "localbooks_balance_today": round(current_balance, 2),
        "unreconciled_count": len(unreconciled),
        "unreconciled_transactions": unreconciled,
    }


def get_localbooks_balance_as_of(conn: sqlite3.Connection, company_id: int,
                                  bank_account_id: int, as_of_date: str) -> float:
    """Return the LocalBooks balance for a bank account as of a specific date (includes opening balance)."""
    row = conn.execute("""
        SELECT COALESCE(SUM(amount), 0) AS balance
        FROM transactions
        WHERE company_id=? AND bank_account_id=? AND txn_date <= ?
    """, (company_id, bank_account_id, as_of_date)).fetchone()
    balance = float(row["balance"]) if row else 0.0

    # Add opening balance if its date is on or before the as_of_date
    ob_row = conn.execute("""
        SELECT opening_balance, opening_balance_date FROM bank_accounts
        WHERE id=? AND opening_balance_date IS NOT NULL AND opening_balance_date <= ?
    """, (bank_account_id, as_of_date)).fetchone()
    if ob_row and ob_row["opening_balance"]:
        balance += float(ob_row["opening_balance"])

    return balance


def save_reconciliation(conn: sqlite3.Connection, company_id: int, bank_account_id: int,
                        reconciled_date: str, statement_balance: float,
                        localbooks_balance: float, transaction_ids: List[int],
                        notes: Optional[str] = None) -> int:
    """
    Save a reconciliation record and mark the given transactions as reconciled.
    Returns the new reconciliation ID.
    """
    difference = round(statement_balance - localbooks_balance, 2)
    status = "reconciled" if abs(difference) < 0.01 else "discrepancy"
    now = _now()

    cur = conn.execute("""
        INSERT INTO reconciliations
            (company_id, bank_account_id, reconciled_date, statement_balance,
             localbooks_balance, difference, status, notes, created_at)
        VALUES (?,?,?,?,?,?,?,?,?)
    """, (company_id, bank_account_id, reconciled_date, statement_balance,
          localbooks_balance, difference, status, notes, now))
    rec_id = int(cur.lastrowid)

    # Mark transactions as reconciled
    if transaction_ids:
        placeholders = ",".join("?" * len(transaction_ids))
        conn.execute(
            f"UPDATE transactions SET is_reconciled=1, reconciliation_id=?, updated_at=? WHERE id IN ({placeholders})",
            [rec_id, now] + transaction_ids,
        )

    conn.commit()
    return rec_id


def list_reconciliations(conn: sqlite3.Connection, company_id: int,
                         bank_account_id: Optional[int] = None) -> List[Dict]:
    sql = "SELECT * FROM reconciliations WHERE company_id=?"
    params: list = [company_id]
    if bank_account_id:
        sql += " AND bank_account_id=?"
        params.append(bank_account_id)
    sql += " ORDER BY reconciled_date DESC, id DESC"
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


# ═══════════════════════════════════════════════════════
#  DUPLICATE DETECTION
# ═══════════════════════════════════════════════════════

def _desc_matches(existing_desc: str, desc_lower: str) -> bool:
    """Return True if two descriptions are similar enough to be considered the same."""
    if existing_desc == desc_lower:
        return True
    if desc_lower in existing_desc or existing_desc in desc_lower:
        return True
    words_new = set(desc_lower.split())
    words_old = set(existing_desc.split())
    if words_new and words_old:
        overlap = len(words_new & words_old) / max(len(words_new), len(words_old))
        if overlap > 0.5:
            return True
    return False


def _pick_desc_match(rows: list, description: str) -> Optional[Dict]:
    """Given a list of candidate rows, return the best description match (or rows[0] if no description)."""
    if not rows:
        return None
    if description:
        desc_lower = description.lower().strip()
        for row in rows:
            existing_desc = (row.get("description") or "").lower().strip()
            if _desc_matches(existing_desc, desc_lower):
                return row
        # No description match found — don't treat as duplicate
        return None
    return rows[0]


def find_duplicate_transaction(conn: sqlite3.Connection, company_id: int,
                                txn_date: str, amount: float,
                                description: str = "") -> Optional[Dict]:
    # 1. Check posted transactions — exact date match
    sql = """
        SELECT t.*, v.name AS vendor_name, a.name AS account_name
        FROM transactions t
        LEFT JOIN vendors v ON t.vendor_id = v.id
        LEFT JOIN accounts a ON t.account_id = a.id
        WHERE t.company_id=? AND t.txn_date=? AND ABS(t.amount - ?) < 0.01
    """
    rows = [dict(r) for r in conn.execute(sql, [company_id, txn_date, amount]).fetchall()]
    match = _pick_desc_match(rows, description)
    if match is not None:
        return match

    # 2. Check staging (document_transactions not yet posted).
    #    Catches re-imports of the same statement before any transactions are posted.
    staging_sql = """
        SELECT dt.id, dt.txn_date, dt.description, dt.amount
        FROM document_transactions dt
        JOIN documents d ON dt.document_id = d.id
        WHERE d.company_id=? AND dt.txn_date=? AND ABS(dt.amount - ?) < 0.01
          AND dt.status NOT IN ('rejected', 'duplicate')
    """
    staging_rows = [dict(r) for r in conn.execute(staging_sql, [company_id, txn_date, amount]).fetchall()]
    staging_match = _pick_desc_match(staging_rows, description)
    if staging_match is not None:
        staging_match["_staging"] = True
        return staging_match

    return None


def check_doc_transaction_duplicate(conn: sqlite3.Connection, company_id: int,
                                     txn_date: str, amount: float,
                                     description: str = "") -> Tuple[bool, Optional[int]]:
    dup = find_duplicate_transaction(conn, company_id, txn_date, amount, description)
    if dup:
        # Staging matches have no committed transaction id to link to
        if dup.get("_staging"):
            return True, None
        return True, int(dup["id"])
    return False, None


# ═══════════════════════════════════════════════════════
#  BACKUP / RESTORE
# ═══════════════════════════════════════════════════════

def backup_database(conn: sqlite3.Connection, backup_path: str) -> None:
    import shutil
    db_path = conn.execute("PRAGMA database_list").fetchone()["file"]
    if db_path:
        conn.execute("PRAGMA wal_checkpoint(FULL)")
        shutil.copy2(db_path, backup_path)
