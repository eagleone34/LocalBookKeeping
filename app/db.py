from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Iterable, Optional

DB_FILENAME = "local_bookkeeping.db"


SCHEMA_STATEMENTS: Iterable[str] = [
    """
    CREATE TABLE IF NOT EXISTS company (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        created_at TEXT NOT NULL
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        parent_id INTEGER,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        FOREIGN KEY(company_id) REFERENCES company(id),
        FOREIGN KEY(parent_id) REFERENCES accounts(id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS vendors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        account_id INTEGER NOT NULL,
        vendor_id INTEGER,
        txn_date TEXT NOT NULL,
        description TEXT,
        amount REAL NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(company_id) REFERENCES company(id),
        FOREIGN KEY(account_id) REFERENCES accounts(id),
        FOREIGN KEY(vendor_id) REFERENCES vendors(id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        account_id INTEGER NOT NULL,
        month TEXT NOT NULL,
        amount REAL NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(company_id, account_id, month),
        FOREIGN KEY(company_id) REFERENCES company(id),
        FOREIGN KEY(account_id) REFERENCES accounts(id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        path TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        FOREIGN KEY(company_id) REFERENCES company(id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS document_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        txn_date TEXT,
        description TEXT,
        amount REAL,
        vendor_name TEXT,
        suggested_account_id INTEGER,
        confidence REAL,
        status TEXT NOT NULL DEFAULT 'review',
        FOREIGN KEY(document_id) REFERENCES documents(id),
        FOREIGN KEY(suggested_account_id) REFERENCES accounts(id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS categorization_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        pattern TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        priority INTEGER NOT NULL DEFAULT 10,
        is_active INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY(company_id) REFERENCES company(id),
        FOREIGN KEY(account_id) REFERENCES accounts(id)
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        entity TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        created_at TEXT NOT NULL,
        details TEXT,
        FOREIGN KEY(company_id) REFERENCES company(id)
    );
    """,
]


def get_db_path(base_dir: Path) -> Path:
    return base_dir / DB_FILENAME


def connect_db(db_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    return connection


def init_db(connection: sqlite3.Connection) -> None:
    cursor = connection.cursor()
    for statement in SCHEMA_STATEMENTS:
        cursor.execute(statement)
    connection.commit()


def ensure_company(connection: sqlite3.Connection, name: str, currency: str, created_at: str) -> int:
    cursor = connection.cursor()
    cursor.execute("SELECT id FROM company LIMIT 1")
    row = cursor.fetchone()
    if row:
        return int(row["id"])
    cursor.execute(
        "INSERT INTO company (name, currency, created_at) VALUES (?, ?, ?)",
        (name, currency, created_at),
    )
    connection.commit()
    return int(cursor.lastrowid)


def seed_sample_data(connection: sqlite3.Connection, company_id: int, created_at: str) -> None:
    cursor = connection.cursor()
    cursor.execute("SELECT COUNT(*) AS count FROM accounts")
    if cursor.fetchone()["count"] > 0:
        return
    accounts = [
        (company_id, "Sales", "income", None, 1, created_at),
        (company_id, "Consulting", "income", None, 1, created_at),
        (company_id, "Office Supplies", "expense", None, 1, created_at),
        (company_id, "Travel", "expense", None, 1, created_at),
        (company_id, "Cash", "asset", None, 1, created_at),
        (company_id, "Credit Card", "liability", None, 1, created_at),
    ]
    cursor.executemany(
        "INSERT INTO accounts (company_id, name, type, parent_id, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        accounts,
    )
    connection.commit()


def upsert_vendor(connection: sqlite3.Connection, name: str) -> Optional[int]:
    if not name:
        return None
    cursor = connection.cursor()
    cursor.execute("SELECT id FROM vendors WHERE name = ?", (name,))
    row = cursor.fetchone()
    if row:
        return int(row["id"])
    cursor.execute("INSERT INTO vendors (name) VALUES (?)", (name,))
    connection.commit()
    return int(cursor.lastrowid)
