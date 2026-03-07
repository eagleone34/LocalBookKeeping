from datetime import datetime

from app.db import connect_db, ensure_company, init_db
from app.services.data_service import DataService, DocumentTransactionRecord


def make_service():
    connection = connect_db(":memory:")
    init_db(connection)
    company_id = ensure_company(connection, "TestCo", "USD", datetime.utcnow().isoformat())
    return DataService(connection, company_id)


def test_account_and_transaction_flow():
    service = make_service()
    service.add_account("Sales", "income", None)
    service.add_account("Travel", "expense", None)

    accounts = service.list_accounts()
    assert len(accounts) == 2

    travel = next(acc for acc in accounts if acc.name == "Travel")
    service.add_transaction("2025-01-15", "Flight", -200.0, "Delta", travel.id)

    transactions = service.list_transactions()
    assert len(transactions) == 1
    assert transactions[0].vendor_name == "Delta"


def test_budget_and_reports():
    service = make_service()
    service.add_account("Sales", "income", None)
    service.add_account("Office Supplies", "expense", None)

    accounts = service.list_accounts()
    supplies = next(acc for acc in accounts if acc.name == "Office Supplies")

    service.upsert_budget("2025-02", 500.0, supplies.id)
    service.add_transaction("2025-02-10", "Paper", -120.0, "Staples", supplies.id)

    budget_rows = service.budget_vs_actual()
    assert budget_rows[0]["budgeted"] == 500.0

    expense_rows = service.expense_by_category()
    assert expense_rows[0]["account_name"] == "Office Supplies"


def test_document_listing():
    service = make_service()
    doc_id = service.add_document("statement.pdf", "/tmp/statement.pdf")
    service.add_document_transactions(
        doc_id,
        [
            DocumentTransactionRecord(
                id=0,
                document_id=doc_id,
                txn_date="2025-02-05",
                description="Test Charge",
                amount=-45.0,
                vendor_name="Vendor",
                suggested_account_id=None,
                confidence=0.5,
                status="review",
            )
        ],
    )
    documents = service.list_documents()
    assert len(documents) == 1

    document_rows = service.list_all_document_transactions()
    assert len(document_rows) == 1
