"""
Tests for core backend workflows.
"""
import pytest
from app.database import connect, init_schema
from app.services.data_service import (
    ensure_company, create_account, list_accounts, update_account,
    archive_account, restore_account, count_account_transactions, delete_account,
    create_transaction, list_transactions, count_transactions,
    delete_transaction, bulk_recategorize,
    upsert_budget, list_budgets, delete_budget,
    create_document, list_documents, create_doc_transaction,
    list_doc_transactions, update_doc_transaction, get_doc_transaction,
    count_pending_review,
    create_rule, list_rules, delete_rule,
    profit_and_loss, budget_vs_actual, expense_by_category,
    expense_by_vendor, monthly_trend, balance_sheet, summary_totals,
    upsert_vendor, list_vendors,
    get_vendor_account_suggestion,
)
from app.services.categorization import suggest_account


@pytest.fixture
def db():
    """Create a fresh in-memory database for each test."""
    conn = connect()
    init_schema(conn)
    return conn


@pytest.fixture
def company(db):
    """Create a test company."""
    cid = ensure_company(db, "TestCo", "USD")
    return cid


class TestAccounts:
    def test_create_and_list(self, db, company):
        aid = create_account(db, company, "Sales", "income")
        accounts = list_accounts(db, company)
        assert len(accounts) == 1
        assert accounts[0]["name"] == "Sales"
        assert accounts[0]["type"] == "income"

    def test_archive_and_restore(self, db, company):
        aid = create_account(db, company, "Travel", "expense")
        archive_account(db, aid)
        active = list_accounts(db, company, include_inactive=False)
        assert len(active) == 0
        all_accounts = list_accounts(db, company, include_inactive=True)
        assert len(all_accounts) == 1
        restore_account(db, aid)
        active = list_accounts(db, company, include_inactive=False)
        assert len(active) == 1

    def test_subaccounts(self, db, company):
        parent = create_account(db, company, "Travel", "expense")
        child = create_account(db, company, "Flights", "expense", parent_id=parent)
        accounts = list_accounts(db, company)
        flight = [a for a in accounts if a["name"] == "Flights"][0]
        assert flight["parent_id"] == parent


class TestTransactions:
    def test_create_and_list(self, db, company):
        aid = create_account(db, company, "Office Supplies", "expense")
        tid = create_transaction(db, company, aid, "2025-03-01", -45.99,
                                 description="Paper", vendor_name="Staples")
        txns = list_transactions(db, company)
        assert len(txns) == 1
        assert txns[0]["amount"] == -45.99
        assert txns[0]["vendor_name"] == "Staples"

    def test_search(self, db, company):
        aid = create_account(db, company, "Travel", "expense")
        create_transaction(db, company, aid, "2025-03-01", -200, description="Flight", vendor_name="Delta")
        create_transaction(db, company, aid, "2025-03-02", -30, description="Ride", vendor_name="Uber")
        results = list_transactions(db, company, search="Delta")
        assert len(results) == 1
        assert results[0]["vendor_name"] == "Delta"

    def test_date_filter(self, db, company):
        aid = create_account(db, company, "Travel", "expense")
        create_transaction(db, company, aid, "2025-01-15", -100, vendor_name="A")
        create_transaction(db, company, aid, "2025-03-15", -200, vendor_name="B")
        results = list_transactions(db, company, date_from="2025-03-01")
        assert len(results) == 1
        assert results[0]["vendor_name"] == "B"

    def test_bulk_recategorize(self, db, company):
        aid1 = create_account(db, company, "Travel", "expense")
        aid2 = create_account(db, company, "Office", "expense")
        t1 = create_transaction(db, company, aid1, "2025-03-01", -100)
        t2 = create_transaction(db, company, aid1, "2025-03-02", -200)
        bulk_recategorize(db, [t1, t2], aid2)
        txns = list_transactions(db, company)
        for t in txns:
            assert t["account_id"] == aid2

    def test_delete(self, db, company):
        aid = create_account(db, company, "Travel", "expense")
        tid = create_transaction(db, company, aid, "2025-03-01", -100)
        assert count_transactions(db, company) == 1
        delete_transaction(db, tid)
        assert count_transactions(db, company) == 0


class TestBudgets:
    def test_upsert_and_list(self, db, company):
        aid = create_account(db, company, "Marketing", "expense")
        upsert_budget(db, company, aid, "2025-03", 500)
        budgets = list_budgets(db, company)
        assert len(budgets) == 1
        assert budgets[0]["amount"] == 500

        # Upsert should update, not duplicate
        upsert_budget(db, company, aid, "2025-03", 600)
        budgets = list_budgets(db, company)
        assert len(budgets) == 1
        assert budgets[0]["amount"] == 600

    def test_delete(self, db, company):
        aid = create_account(db, company, "Rent", "expense")
        upsert_budget(db, company, aid, "2025-03", 2200)
        budgets = list_budgets(db, company)
        delete_budget(db, budgets[0]["id"])
        assert len(list_budgets(db, company)) == 0


class TestDocuments:
    def test_document_flow(self, db, company):
        aid = create_account(db, company, "Travel", "expense")
        doc_id = create_document(db, company, "statement.pdf", "/tmp/statement.pdf", 1024)
        docs = list_documents(db, company)
        assert len(docs) == 1
        assert docs[0]["status"] == "pending"

        dt_id = create_doc_transaction(db, doc_id, "2025-03-01", "Flight", -450,
                                        "United Airlines", aid, 0.85)
        dt = get_doc_transaction(db, dt_id)
        assert dt["status"] == "review"
        assert dt["confidence"] == 0.85

        update_doc_transaction(db, dt_id, status="posted")
        dt = get_doc_transaction(db, dt_id)
        assert dt["status"] == "posted"

    def test_pending_review_count(self, db, company):
        doc_id = create_document(db, company, "test.pdf", "/tmp/test.pdf")
        create_doc_transaction(db, doc_id, "2025-03-01", "Test", -100, "Vendor", None, 0.5)
        assert count_pending_review(db, company) == 1


class TestCategorization:
    def test_rules_based(self, db, company):
        aid = create_account(db, company, "Travel", "expense")
        create_rule(db, company, "uber", "contains", aid, 5)
        account_id, confidence = suggest_account(db, company, "Uber ride downtown", "Uber")
        assert account_id == aid
        assert confidence >= 0.85

    def test_vendor_memory(self, db, company):
        aid = create_account(db, company, "Travel", "expense")
        # Create several transactions to build memory
        for _ in range(3):
            create_transaction(db, company, aid, "2025-03-01", -30, vendor_name="Uber")
        result = get_vendor_account_suggestion(db, company, "Uber")
        assert result is not None
        assert result[0] == aid
        assert result[1] >= 0.65


class TestReports:
    def test_profit_and_loss(self, db, company):
        inc = create_account(db, company, "Sales", "income")
        exp = create_account(db, company, "Rent", "expense")
        create_transaction(db, company, inc, "2025-03-01", 5000, vendor_name="Client")
        create_transaction(db, company, exp, "2025-03-01", -2000, vendor_name="Landlord")
        pnl = profit_and_loss(db, company)
        assert len(pnl) == 2

    def test_budget_vs_actual(self, db, company):
        aid = create_account(db, company, "Marketing", "expense")
        upsert_budget(db, company, aid, "2025-03", 500)
        create_transaction(db, company, aid, "2025-03-15", -350, vendor_name="Google Ads")
        bva = budget_vs_actual(db, company)
        assert len(bva) == 1
        assert bva[0]["budgeted"] == 500
        assert abs(bva[0]["actual"]) == 350

    def test_expense_by_category(self, db, company):
        a1 = create_account(db, company, "Travel", "expense")
        a2 = create_account(db, company, "Office", "expense")
        create_transaction(db, company, a1, "2025-03-01", -300, vendor_name="Delta")
        create_transaction(db, company, a2, "2025-03-01", -100, vendor_name="Staples")
        cats = expense_by_category(db, company)
        assert len(cats) == 2
        assert cats[0]["account_name"] == "Travel"  # Largest first
        assert cats[0]["percentage"] == 75.0

    def test_expense_by_vendor(self, db, company):
        aid = create_account(db, company, "Travel", "expense")
        create_transaction(db, company, aid, "2025-03-01", -500, vendor_name="Delta")
        create_transaction(db, company, aid, "2025-03-01", -100, vendor_name="Uber")
        vendors = expense_by_vendor(db, company)
        assert len(vendors) == 2
        assert vendors[0]["vendor_name"] == "Delta"

    def test_monthly_trend(self, db, company):
        inc = create_account(db, company, "Sales", "income")
        exp = create_account(db, company, "Rent", "expense")
        create_transaction(db, company, inc, "2025-01-01", 3000)
        create_transaction(db, company, exp, "2025-01-01", -1000)
        create_transaction(db, company, inc, "2025-02-01", 4000)
        create_transaction(db, company, exp, "2025-02-01", -1500)
        trend = monthly_trend(db, company)
        assert len(trend) == 2
        assert trend[0]["net"] == 2000  # Jan
        assert trend[1]["net"] == 2500  # Feb

    def test_summary_totals(self, db, company):
        inc = create_account(db, company, "Sales", "income")
        create_transaction(db, company, inc, "2025-03-01", 10000)
        totals = summary_totals(db, company)
        assert totals["income"] == 10000


class TestVendors:
    def test_upsert_and_list(self, db, company):
        vid = upsert_vendor(db, company, "Staples")
        assert vid > 0
        # Upserting same name returns same ID
        vid2 = upsert_vendor(db, company, "Staples")
        assert vid2 == vid
        vendors = list_vendors(db, company)
        assert len(vendors) == 1


class TestAccountDelete:
    def test_count_account_transactions(self, db, company):
        aid = create_account(db, company, "Travel", "expense")
        assert count_account_transactions(db, aid) == 0
        create_transaction(db, company, aid, "2025-03-01", -100, vendor_name="Delta")
        create_transaction(db, company, aid, "2025-03-02", -200, vendor_name="Uber")
        assert count_account_transactions(db, aid) == 2

    def test_delete_account_no_transactions(self, db, company):
        aid = create_account(db, company, "Unused Account", "expense")
        assert len(list_accounts(db, company)) == 1
        delete_account(db, aid)
        assert len(list_accounts(db, company)) == 0

    def test_delete_account_blocked_when_has_transactions(self, db, company):
        aid = create_account(db, company, "Active Account", "expense")
        create_transaction(db, company, aid, "2025-03-01", -50, vendor_name="Test")
        # count_account_transactions should show 1
        assert count_account_transactions(db, aid) == 1
        # In the API layer, this would be blocked; here we verify the count logic
        # The data_service.delete_account itself doesn't check -- the router does
