"""
Core data service – all database operations go through here.
Single-responsibility: translate between Python dicts/models and SQLite rows.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple


def _now() -> str:
    return datetime.utcnow().isoformat()


# ═══════════════════════════════════════════════════════
#  COMPANY
# ═══════════════════════════════════════════════════════

def ensure_company(conn: sqlite3.Connection, name: str = "My Company", currency: str = "USD") -> int:
    row = conn.execute("SELECT id FROM company LIMIT 1").fetchone()
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
                   description: Optional[str] = None) -> int:
    now = _now()
    cur = conn.execute(
        """INSERT INTO accounts (company_id, name, type, parent_id, code, description, is_active, created_at, updated_at)
           VALUES (?,?,?,?,?,?,1,?,?)""",
        (company_id, name, acct_type, parent_id, code, description, now, now),
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
    """Return the number of transactions linked to this account."""
    row = conn.execute("SELECT COUNT(*) as cnt FROM transactions WHERE account_id=?", (account_id,)).fetchone()
    return int(row["cnt"])


def delete_account(conn: sqlite3.Connection, account_id: int) -> None:
    """Delete an account. Caller must verify no transactions exist first."""
    conn.execute("DELETE FROM accounts WHERE id=?", (account_id,))
    conn.commit()


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
                      vendor_id: Optional[int] = None,
                      search: Optional[str] = None,
                      date_from: Optional[str] = None,
                      date_to: Optional[str] = None,
                      limit: int = 500, offset: int = 0) -> List[Dict]:
    sql = """
        SELECT t.*, a.name AS account_name, a.type AS account_type,
               v.name AS vendor_name
        FROM transactions t
        JOIN accounts a ON t.account_id = a.id
        LEFT JOIN vendors v ON t.vendor_id = v.id
        WHERE t.company_id = ?
    """
    params: list = [company_id]
    if account_id:
        sql += " AND t.account_id=?"
        params.append(account_id)
    if vendor_id:
        sql += " AND t.vendor_id=?"
        params.append(vendor_id)
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
                       source_doc_id: Optional[int] = None) -> int:
    vendor_id = upsert_vendor(conn, company_id, vendor_name) if vendor_name else None
    now = _now()
    cur = conn.execute(
        """INSERT INTO transactions
           (company_id, account_id, vendor_id, txn_date, description, memo, amount, is_posted, source, source_doc_id, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,1,?,?,?,?)""",
        (company_id, account_id, vendor_id, txn_date, description, memo, amount, source, source_doc_id, now, now),
    )
    conn.commit()
    # Update vendor-account mapping for smart categorization
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
    """
    Delete a document and all its associated data:
    1. Associated staging transactions (document_transactions)
    2. Associated posted transactions (ledger)
    3. The actual file on disk
    4. The document record itself
    """
    doc = conn.execute("SELECT file_path FROM documents WHERE id=?", (doc_id,)).fetchone()
    if not doc:
        return

    # Delete staging transactions
    conn.execute("DELETE FROM document_transactions WHERE document_id=?", (doc_id,))
    
    # Delete posted transactions in the ledger
    conn.execute("DELETE FROM transactions WHERE source_doc_id=?", (doc_id,))
    
    # Delete the physical file
    file_path = doc["file_path"]
    if file_path and os.path.exists(file_path):
        try:
            os.remove(file_path)
        except Exception as e:
            print(f"Error deleting file {file_path}: {e}")
            
    # Delete the document record
    conn.execute("DELETE FROM documents WHERE id=?", (doc_id,))
    conn.commit()


def delete_doc_transaction(conn: sqlite3.Connection, dt_id: int) -> None:
    """Delete a single staging transaction from the inbox."""
    conn.execute("DELETE FROM document_transactions WHERE id=?", (dt_id,))
    conn.commit()


def create_doc_transaction(conn: sqlite3.Connection, doc_id: int,
                           txn_date: str, description: str, amount: float,
                           vendor_name: str, suggested_account_id: Optional[int],
                           confidence: float) -> int:
    now = _now()
    cur = conn.execute(
        """INSERT INTO document_transactions
           (document_id, txn_date, description, amount, vendor_name, suggested_account_id, confidence, status, created_at)
           VALUES (?,?,?,?,?,?,?,'review',?)""",
        (doc_id, txn_date, description, amount, vendor_name, suggested_account_id, confidence, now),
    )
    conn.commit()
    return int(cur.lastrowid)


def list_doc_transactions(conn: sqlite3.Connection, doc_id: Optional[int] = None,
                          status: Optional[str] = None,
                          company_id: Optional[int] = None) -> List[Dict]:
    sql = """
        SELECT dt.*, a1.name AS suggested_account_name, a2.name AS user_account_name
        FROM document_transactions dt
        JOIN documents d ON dt.document_id = d.id
        LEFT JOIN accounts a1 ON dt.suggested_account_id = a1.id
        LEFT JOIN accounts a2 ON dt.user_account_id = a2.id
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
        # Support special 'duplicate' filter that matches is_duplicate flag
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
#  VENDOR-ACCOUNT MAP (Smart categorization memory)
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
                    date_from: Optional[str] = None, date_to: Optional[str] = None) -> List[Dict]:
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
    sql += " GROUP BY a.type, month ORDER BY month, a.type"
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def budget_vs_actual(conn: sqlite3.Connection, company_id: int,
                     month: Optional[str] = None) -> List[Dict]:
    sql = """
        SELECT b.month, b.account_id, a.name AS account_name, a.type AS account_type,
               b.amount AS budgeted,
               COALESCE(SUM(t.amount), 0) AS actual,
               b.amount - COALESCE(SUM(t.amount), 0) AS variance
        FROM budgets b
        JOIN accounts a ON b.account_id = a.id
        LEFT JOIN transactions t
            ON t.account_id = a.id
            AND strftime('%Y-%m', t.txn_date) = b.month
            AND t.company_id = b.company_id
        WHERE b.company_id=?
    """
    params: list = [company_id]
    if month:
        sql += " AND b.month=?"
        params.append(month)
    sql += " GROUP BY b.month, b.account_id, a.name, a.type, b.amount ORDER BY b.month DESC, a.name"
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def expense_by_category(conn: sqlite3.Connection, company_id: int,
                        date_from: Optional[str] = None, date_to: Optional[str] = None) -> List[Dict]:
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
    sql += " GROUP BY a.id, a.name ORDER BY total DESC"
    rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
    grand = sum(r["total"] for r in rows) or 1
    for r in rows:
        r["percentage"] = round(r["total"] / grand * 100, 1)
    return rows


def expense_by_vendor(conn: sqlite3.Connection, company_id: int,
                      date_from: Optional[str] = None, date_to: Optional[str] = None) -> List[Dict]:
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
    sql += " GROUP BY vendor_name ORDER BY total DESC"
    rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
    grand = sum(r["total"] for r in rows) or 1
    for r in rows:
        r["percentage"] = round(r["total"] / grand * 100, 1)
    return rows


def monthly_trend(conn: sqlite3.Connection, company_id: int, months: int = 12) -> List[Dict]:
    sql = """
        SELECT strftime('%Y-%m', t.txn_date) AS month,
               SUM(CASE WHEN a.type='income' THEN t.amount ELSE 0 END) AS income,
               SUM(CASE WHEN a.type='expense' THEN ABS(t.amount) ELSE 0 END) AS expenses
        FROM transactions t
        JOIN accounts a ON t.account_id = a.id
        WHERE t.company_id=? AND a.type IN ('income','expense')
        GROUP BY month
        ORDER BY month DESC
        LIMIT ?
    """
    rows = [dict(r) for r in conn.execute(sql, (company_id, months)).fetchall()]
    for r in rows:
        r["net"] = r["income"] - r["expenses"]
    rows.reverse()
    return rows


def balance_sheet(conn: sqlite3.Connection, company_id: int) -> List[Dict]:
    sql = """
        SELECT a.type, a.name AS account_name, SUM(t.amount) AS balance
        FROM transactions t
        JOIN accounts a ON t.account_id = a.id
        WHERE t.company_id=? AND a.type IN ('asset','liability')
        GROUP BY a.type, a.name
        ORDER BY a.type, a.name
    """
    return [dict(r) for r in conn.execute(sql, (company_id,)).fetchall()]


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
#  BANK ACCOUNTS (learned from statements)
# ═══════════════════════════════════════════════════════

def upsert_bank_account(conn: sqlite3.Connection, company_id: int,
                        bank_name: str, last_four: str,
                        full_number: str = "", nickname: str = "",
                        ledger_account_id: Optional[int] = None) -> int:
    """Find or create a bank account. Returns the bank_account id."""
    if not bank_name or not last_four:
        return 0
    now = _now()
    row = conn.execute(
        "SELECT id, ledger_account_id FROM bank_accounts WHERE company_id=? AND bank_name=? AND last_four=?",
        (company_id, bank_name, last_four),
    ).fetchone()
    if row:
        # Update ledger mapping if provided and not already set
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
    """Ensure a bank account has a linked ledger account (Asset/Liability). Returns ledger_account_id."""
    ba = get_bank_account(conn, bank_account_id)
    if not ba:
        return 0
    if ba.get("ledger_account_id"):
        return int(ba["ledger_account_id"])

    # Create a new Asset account for this bank account
    company_id = ba["company_id"]
    name = f"{ba['bank_name']} - {ba['last_four']}"
    # Default to 'asset' for bank accounts. If it's a credit card, might be 'liability' 
    # but 'asset' is a safe default for now as most imports are checking/savings.
    # In a full app, we'd guess based on bank name or user input.
    acct_type = "asset"
    
    # Check if an account with this name already exists for the company
    existing = conn.execute(
        "SELECT id FROM accounts WHERE company_id=? AND name=? AND type=?",
        (company_id, name, acct_type)
    ).fetchone()
    
    if existing:
        ledger_id = int(existing["id"])
    else:
        ledger_id = create_account(conn, company_id, name, acct_type)
    
    # Link it back to the bank account
    update_bank_account(conn, bank_account_id, ledger_account_id=ledger_id)
    return ledger_id


def update_bank_account(conn: sqlite3.Connection, bank_account_id: int, **kwargs) -> None:
    sets, vals = [], []
    for k, v in kwargs.items():
        if v is not None:
            sets.append(f"{k}=?")
            vals.append(v)
    if not sets:
        return
    sets.append("updated_at=?")
    vals.append(_now())
    vals.append(bank_account_id)
    conn.execute(f"UPDATE bank_accounts SET {','.join(sets)} WHERE id=?", vals)
    conn.commit()


def find_bank_account_by_last_four(conn: sqlite3.Connection, company_id: int,
                                    bank_name: str, last_four: str) -> Optional[Dict]:
    """Look up a bank account by bank name + last 4 digits."""
    row = conn.execute(
        "SELECT ba.*, a.name AS ledger_account_name FROM bank_accounts ba LEFT JOIN accounts a ON ba.ledger_account_id = a.id WHERE ba.company_id=? AND ba.bank_name=? AND ba.last_four=?",
        (company_id, bank_name, last_four),
    ).fetchone()
    return dict(row) if row else None


# ═══════════════════════════════════════════════════════
#  DUPLICATE DETECTION
# ═══════════════════════════════════════════════════════

def find_duplicate_transaction(conn: sqlite3.Connection, company_id: int,
                                txn_date: str, amount: float,
                                description: str = "") -> Optional[Dict]:
    """
    Check if a transaction with the same date, amount, and similar description
    already exists in the ledger. Returns the existing transaction if found.
    """
    # Exact match on date + amount
    sql = """
        SELECT t.*, v.name AS vendor_name, a.name AS account_name
        FROM transactions t
        LEFT JOIN vendors v ON t.vendor_id = v.id
        LEFT JOIN accounts a ON t.account_id = a.id
        WHERE t.company_id=? AND t.txn_date=? AND ABS(t.amount - ?) < 0.01
    """
    params: list = [company_id, txn_date, amount]

    rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
    if not rows:
        return None

    # If description provided, check for similarity
    if description:
        desc_lower = description.lower().strip()
        for row in rows:
            existing_desc = (row.get("description") or "").lower().strip()
            # Exact match
            if existing_desc == desc_lower:
                return row
            # Partial match (one contains the other or >60% overlap)
            if desc_lower in existing_desc or existing_desc in desc_lower:
                return row
            # Word overlap check
            words_new = set(desc_lower.split())
            words_old = set(existing_desc.split())
            if words_new and words_old:
                overlap = len(words_new & words_old) / max(len(words_new), len(words_old))
                if overlap > 0.5:
                    return row

    # If no description or no desc match, return first date+amount match
    return rows[0]


def check_doc_transaction_duplicate(conn: sqlite3.Connection, company_id: int,
                                     txn_date: str, amount: float,
                                     description: str = "") -> Tuple[bool, Optional[int]]:
    """
    Returns (is_duplicate, existing_txn_id).
    """
    dup = find_duplicate_transaction(conn, company_id, txn_date, amount, description)
    if dup:
        return True, int(dup["id"])
    return False, None


# ═══════════════════════════════════════════════════════
#  BACKUP / RESTORE
# ═══════════════════════════════════════════════════════

def backup_database(conn: sqlite3.Connection, backup_path: str) -> None:
    """Create a full backup of the database."""
    import shutil
    db_path = conn.execute("PRAGMA database_list").fetchone()["file"]
    if db_path:
        conn.execute("PRAGMA wal_checkpoint(FULL)")
        shutil.copy2(db_path, backup_path)
