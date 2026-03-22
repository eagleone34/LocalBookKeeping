"""
Database schema and connection management for LedgerLocal.
Uses SQLite for local-first, zero-config storage.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Optional

DB_FILENAME = "ledgerlocal.db"

SCHEMA_SQL = """
-- Company / file info
CREATE TABLE IF NOT EXISTS company (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    currency    TEXT NOT NULL DEFAULT 'USD',
    fiscal_year_start INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- Chart of Accounts
CREATE TABLE IF NOT EXISTS accounts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL REFERENCES company(id),
    name        TEXT NOT NULL,
    type        TEXT NOT NULL CHECK(type IN ('income','expense','asset','liability','equity')),
    parent_id   INTEGER REFERENCES accounts(id),
    code        TEXT,
    description TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_company ON accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(type);

-- Vendors / Payees
CREATE TABLE IF NOT EXISTS vendors (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL REFERENCES company(id),
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    UNIQUE(company_id, name)
);

-- Transactions (the core ledger)
CREATE TABLE IF NOT EXISTS transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL REFERENCES company(id),
    account_id  INTEGER NOT NULL REFERENCES accounts(id),
    vendor_id   INTEGER REFERENCES vendors(id),
    txn_date    TEXT NOT NULL,
    description TEXT,
    memo        TEXT,
    amount      REAL NOT NULL,
    is_posted   INTEGER NOT NULL DEFAULT 1,
    source      TEXT NOT NULL DEFAULT 'manual',
    source_doc_id INTEGER REFERENCES documents(id),
    bank_account_id INTEGER REFERENCES bank_accounts(id),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_txn_company_date ON transactions(company_id, txn_date);
CREATE INDEX IF NOT EXISTS idx_txn_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_txn_vendor ON transactions(vendor_id);

-- Monthly Budgets
CREATE TABLE IF NOT EXISTS budgets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL REFERENCES company(id),
    account_id  INTEGER NOT NULL REFERENCES accounts(id),
    month       TEXT NOT NULL,
    amount      REAL NOT NULL,
    notes       TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE(company_id, account_id, month)
);

-- Uploaded PDF documents
CREATE TABLE IF NOT EXISTS documents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL REFERENCES company(id),
    filename    TEXT NOT NULL,
    file_path   TEXT NOT NULL,
    file_size   INTEGER,
    page_count  INTEGER,
    status      TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','review','completed','error')),
    error_msg   TEXT,
    bank_name   TEXT,
    account_last_four TEXT,
    bank_account_id INTEGER REFERENCES bank_accounts(id),
    imported_at TEXT NOT NULL,
    processed_at TEXT
);

-- Extracted transactions from PDFs (staging before posting)
CREATE TABLE IF NOT EXISTS document_transactions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id         INTEGER NOT NULL REFERENCES documents(id),
    txn_date            TEXT,
    description         TEXT,
    amount              REAL,
    vendor_name         TEXT,
    suggested_account_id INTEGER REFERENCES accounts(id),
    confidence          REAL DEFAULT 0.0,
    status              TEXT NOT NULL DEFAULT 'review' CHECK(status IN ('review','approved','rejected','posted','duplicate')),
    user_account_id     INTEGER REFERENCES accounts(id),
    is_duplicate        INTEGER NOT NULL DEFAULT 0,
    duplicate_of_txn_id INTEGER,
    bank_account_id     INTEGER REFERENCES bank_accounts(id),
    created_at          TEXT NOT NULL
);

-- Categorization rules (keyword -> account mapping)
CREATE TABLE IF NOT EXISTS categorization_rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL REFERENCES company(id),
    pattern     TEXT NOT NULL,
    match_type  TEXT NOT NULL DEFAULT 'contains' CHECK(match_type IN ('contains','exact','regex')),
    account_id  INTEGER NOT NULL REFERENCES accounts(id),
    priority    INTEGER NOT NULL DEFAULT 10,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL
);

-- Vendor-to-account memory (learned mappings)
CREATE TABLE IF NOT EXISTS vendor_account_map (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL REFERENCES company(id),
    vendor_name TEXT NOT NULL,
    account_id  INTEGER NOT NULL REFERENCES accounts(id),
    hit_count   INTEGER NOT NULL DEFAULT 1,
    last_used   TEXT NOT NULL,
    UNIQUE(company_id, vendor_name)
);

-- Bank accounts (learned from PDF statements)
CREATE TABLE IF NOT EXISTS bank_accounts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL REFERENCES company(id),
    bank_name   TEXT NOT NULL,
    last_four   TEXT NOT NULL,
    full_number TEXT,
    nickname    TEXT,
    ledger_account_id INTEGER REFERENCES accounts(id),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE(company_id, bank_name, last_four)
);

-- Audit trail
CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL REFERENCES company(id),
    entity_type TEXT NOT NULL,
    entity_id   INTEGER,
    action      TEXT NOT NULL,
    details     TEXT,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_company ON audit_log(company_id);
"""


def get_db_path(base_dir: Path) -> Path:
    """Get the full path to the database file."""
    return base_dir / DB_FILENAME


def connect(db_path: Optional[Path] = None) -> sqlite3.Connection:
    """Create a connection to the SQLite database."""
    path = str(db_path) if db_path else ":memory:"
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    """Initialize all tables and run migrations for existing DBs."""
    conn.executescript(SCHEMA_SQL)
    conn.commit()
    _migrate(conn)


def _migrate(conn: sqlite3.Connection) -> None:
    """Add columns that may be missing in older databases."""
    migrations = [
        ("transactions", "bank_account_id", "ALTER TABLE transactions ADD COLUMN bank_account_id INTEGER REFERENCES bank_accounts(id)"),
        ("transactions", "category_id", "ALTER TABLE transactions ADD COLUMN category_id INTEGER REFERENCES accounts(id)"),
        ("document_transactions", "is_duplicate", "ALTER TABLE document_transactions ADD COLUMN is_duplicate INTEGER NOT NULL DEFAULT 0"),
        ("document_transactions", "duplicate_of_txn_id", "ALTER TABLE document_transactions ADD COLUMN duplicate_of_txn_id INTEGER"),
        ("document_transactions", "bank_account_id", "ALTER TABLE document_transactions ADD COLUMN bank_account_id INTEGER REFERENCES bank_accounts(id)"),
        ("document_transactions", "category_id", "ALTER TABLE document_transactions ADD COLUMN category_id INTEGER REFERENCES accounts(id)"),
        ("documents", "bank_name", "ALTER TABLE documents ADD COLUMN bank_name TEXT"),
        ("documents", "account_last_four", "ALTER TABLE documents ADD COLUMN account_last_four TEXT"),
        ("documents", "bank_account_id", "ALTER TABLE documents ADD COLUMN bank_account_id INTEGER REFERENCES bank_accounts(id)"),
    ]
    for table, column, sql in migrations:
        try:
            cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
            if column not in cols:
                conn.execute(sql)
                conn.commit()
        except Exception:
            pass
    
        # --- Backfill blank account codes ---
        try:
            blank_count = conn.execute(
                "SELECT COUNT(*) FROM accounts WHERE code IS NULL OR code = ''"
            ).fetchone()[0]
            if blank_count > 0:
                code_bases = {
                    "asset": 1000,
                    "liability": 2000,
                    "equity": 3000,
                    "income": 4000,
                    "expense": 5000,
                }
    
                company_ids = [
                    r[0] for r in conn.execute("SELECT DISTINCT company_id FROM accounts").fetchall()
                ]
    
                for cid in company_ids:
                    blanks = conn.execute(
                        "SELECT id, type FROM accounts WHERE company_id=? AND (code IS NULL OR code = '')",
                        (cid,),
                    ).fetchall()
                    if not blanks:
                        continue
    
                    for acct_id, acct_type in blanks:
                        base = code_bases.get(acct_type, 5000)
                        range_end = base + 999
    
                        rows = conn.execute(
                            "SELECT code FROM accounts WHERE company_id=? AND type=? AND code IS NOT NULL AND code != ''",
                            (cid, acct_type),
                        ).fetchall()
    
                        max_code = base - 10
                        for row in rows:
                            try:
                                val = int(row[0])
                                if base <= val <= range_end and val > max_code:
                                    max_code = val
                            except (ValueError, TypeError):
                                continue
    
                        new_code = str(max_code + 10)
                        now = datetime.utcnow().isoformat()
                        conn.execute(
                            "UPDATE accounts SET code=?, updated_at=? WHERE id=?",
                            (new_code, now, acct_id),
                        )
    
                conn.commit()
        except Exception:
            pass

    # ═══════════════════════════════════════════════════════
    #  Data Migration: Copy account_id to category_id for existing records
    #  This ensures backward compatibility with the new Account/Category separation
    # ═══════════════════════════════════════════════════════
    try:
        # Check if we need to migrate transactions
        cols = [r[1] for r in conn.execute("PRAGMA table_info(transactions)").fetchall()]
        if "category_id" in cols:
            # Migrate transactions: copy account_id to category_id where category_id is NULL
            conn.execute("""
                UPDATE transactions
                SET category_id = account_id
                WHERE category_id IS NULL AND account_id IS NOT NULL
            """)
            # Migrate document_transactions: copy suggested_account_id to category_id
            conn.execute("""
                UPDATE document_transactions
                SET category_id = suggested_account_id
                WHERE category_id IS NULL AND suggested_account_id IS NOT NULL
            """)
            conn.commit()
    except Exception:
        pass
