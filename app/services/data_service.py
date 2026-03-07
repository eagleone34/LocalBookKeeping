from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional, Sequence

from app.db import upsert_vendor


@dataclass
class Account:
    id: int
    name: str
    type: str
    parent_id: Optional[int]
    is_active: bool


@dataclass
class TransactionRecord:
    id: int
    txn_date: str
    description: str
    amount: float
    vendor_name: Optional[str]
    account_id: int


@dataclass
class BudgetRecord:
    id: int
    month: str
    amount: float
    account_id: int


@dataclass
class DocumentRecord:
    id: int
    filename: str
    path: str
    status: str


@dataclass
class DocumentTransactionRecord:
    id: int
    document_id: int
    txn_date: str
    description: str
    amount: float
    vendor_name: str
    suggested_account_id: Optional[int]
    confidence: Optional[float]
    status: str


class DataService:
    def __init__(self, connection, company_id: int) -> None:
        self.connection = connection
        self.company_id = company_id

    def list_accounts(self) -> List[Account]:
        cursor = self.connection.cursor()
        cursor.execute(
            "SELECT id, name, type, parent_id, is_active FROM accounts WHERE company_id = ? ORDER BY name",
            (self.company_id,),
        )
        return [
            Account(
                id=row["id"],
                name=row["name"],
                type=row["type"],
                parent_id=row["parent_id"],
                is_active=bool(row["is_active"]),
            )
            for row in cursor.fetchall()
        ]

    def add_account(self, name: str, account_type: str, parent_id: Optional[int]) -> None:
        cursor = self.connection.cursor()
        cursor.execute(
            """
            INSERT INTO accounts (company_id, name, type, parent_id, is_active, created_at)
            VALUES (?, ?, ?, ?, 1, ?)
            """,
            (self.company_id, name, account_type, parent_id, datetime.utcnow().isoformat()),
        )
        self.connection.commit()

    def list_transactions(self) -> List[TransactionRecord]:
        cursor = self.connection.cursor()
        cursor.execute(
            """
            SELECT transactions.id, transactions.txn_date, transactions.description,
                   transactions.amount, vendors.name AS vendor_name, transactions.account_id
            FROM transactions
            LEFT JOIN vendors ON transactions.vendor_id = vendors.id
            WHERE transactions.company_id = ?
            ORDER BY transactions.txn_date DESC
            """,
            (self.company_id,),
        )
        return [
            TransactionRecord(
                id=row["id"],
                txn_date=row["txn_date"],
                description=row["description"],
                amount=row["amount"],
                vendor_name=row["vendor_name"],
                account_id=row["account_id"],
            )
            for row in cursor.fetchall()
        ]

    def add_transaction(
        self,
        txn_date: str,
        description: str,
        amount: float,
        vendor_name: str,
        account_id: int,
    ) -> None:
        vendor_id = upsert_vendor(self.connection, vendor_name)
        cursor = self.connection.cursor()
        cursor.execute(
            """
            INSERT INTO transactions (company_id, account_id, vendor_id, txn_date, description, amount, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                self.company_id,
                account_id,
                vendor_id,
                txn_date,
                description,
                amount,
                datetime.utcnow().isoformat(),
            ),
        )
        self.connection.commit()

    def list_budgets(self) -> List[BudgetRecord]:
        cursor = self.connection.cursor()
        cursor.execute(
            """
            SELECT id, month, amount, account_id
            FROM budgets
            WHERE company_id = ?
            ORDER BY month DESC
            """,
            (self.company_id,),
        )
        return [
            BudgetRecord(
                id=row["id"],
                month=row["month"],
                amount=row["amount"],
                account_id=row["account_id"],
            )
            for row in cursor.fetchall()
        ]

    def upsert_budget(self, month: str, amount: float, account_id: int) -> None:
        cursor = self.connection.cursor()
        cursor.execute(
            """
            INSERT INTO budgets (company_id, account_id, month, amount, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(company_id, account_id, month)
            DO UPDATE SET amount = excluded.amount
            """,
            (self.company_id, account_id, month, amount, datetime.utcnow().isoformat()),
        )
        self.connection.commit()

    def profit_and_loss(self):
        cursor = self.connection.cursor()
        cursor.execute(
            """
            SELECT accounts.type, strftime('%Y-%m', transactions.txn_date) AS month,
                   SUM(transactions.amount) AS total
            FROM transactions
            JOIN accounts ON transactions.account_id = accounts.id
            WHERE transactions.company_id = ?
            GROUP BY accounts.type, month
            ORDER BY month DESC
            """,
            (self.company_id,),
        )
        return cursor.fetchall()

    def budget_vs_actual(self):
        cursor = self.connection.cursor()
        cursor.execute(
            """
            SELECT budgets.month, accounts.name AS account_name,
                   budgets.amount AS budgeted,
                   COALESCE(SUM(transactions.amount), 0) AS actual
            FROM budgets
            JOIN accounts ON budgets.account_id = accounts.id
            LEFT JOIN transactions
                ON transactions.account_id = accounts.id
                AND strftime('%Y-%m', transactions.txn_date) = budgets.month
            WHERE budgets.company_id = ?
            GROUP BY budgets.month, accounts.name, budgets.amount
            ORDER BY budgets.month DESC
            """,
            (self.company_id,),
        )
        return cursor.fetchall()

    def expense_by_vendor(self):
        cursor = self.connection.cursor()
        cursor.execute(
            """
            SELECT vendors.name AS vendor_name, SUM(transactions.amount) AS total
            FROM transactions
            JOIN vendors ON transactions.vendor_id = vendors.id
            JOIN accounts ON transactions.account_id = accounts.id
            WHERE transactions.company_id = ? AND accounts.type = 'expense'
            GROUP BY vendors.name
            ORDER BY total DESC
            """,
            (self.company_id,),
        )
        return cursor.fetchall()

    def expense_by_category(self):
        cursor = self.connection.cursor()
        cursor.execute(
            """
            SELECT accounts.name AS account_name, SUM(transactions.amount) AS total
            FROM transactions
            JOIN accounts ON transactions.account_id = accounts.id
            WHERE transactions.company_id = ? AND accounts.type = 'expense'
            GROUP BY accounts.name
            ORDER BY total DESC
            """,
            (self.company_id,),
        )
        return cursor.fetchall()

    def add_document(self, filename: str, path: str) -> int:
        cursor = self.connection.cursor()
        cursor.execute(
            """
            INSERT INTO documents (company_id, filename, path, imported_at, status)
            VALUES (?, ?, ?, ?, 'review')
            """,
            (self.company_id, filename, path, datetime.utcnow().isoformat()),
        )
        self.connection.commit()
        return int(cursor.lastrowid)

    def add_document_transactions(self, document_id: int, rows: Sequence[DocumentTransactionRecord]) -> None:
        cursor = self.connection.cursor()
        cursor.executemany(
            """
            INSERT INTO document_transactions (
                document_id, txn_date, description, amount, vendor_name,
                suggested_account_id, confidence, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    row.document_id,
                    row.txn_date,
                    row.description,
                    row.amount,
                    row.vendor_name,
                    row.suggested_account_id,
                    row.confidence,
                    row.status,
                )
                for row in rows
            ],
        )
        self.connection.commit()

    def list_document_transactions(self, document_id: int) -> List[DocumentTransactionRecord]:
        cursor = self.connection.cursor()
        cursor.execute(
            """
            SELECT id, document_id, txn_date, description, amount, vendor_name,
                   suggested_account_id, confidence, status
            FROM document_transactions
            WHERE document_id = ?
            ORDER BY id DESC
            """,
            (document_id,),
        )
        return [
            DocumentTransactionRecord(
                id=row["id"],
                document_id=row["document_id"],
                txn_date=row["txn_date"],
                description=row["description"],
                amount=row["amount"],
                vendor_name=row["vendor_name"],
                suggested_account_id=row["suggested_account_id"],
                confidence=row["confidence"],
                status=row["status"],
            )
            for row in cursor.fetchall()
        ]
