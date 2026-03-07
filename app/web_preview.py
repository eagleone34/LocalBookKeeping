from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Iterable

from fastapi import FastAPI
from fastapi.responses import HTMLResponse

from app.db import connect_db, ensure_company, get_db_path, init_db, seed_sample_data
from app.services.data_service import DataService

app = FastAPI(title="Local Bookkeeping Preview")

BASE_DIR = Path(__file__).resolve().parent.parent / "company_data"
BASE_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = get_db_path(BASE_DIR)
CONNECTION = connect_db(DB_PATH)
init_db(CONNECTION)
COMPANY_ID = ensure_company(CONNECTION, "Demo Company", "USD", datetime.utcnow().isoformat())
seed_sample_data(CONNECTION, COMPANY_ID, datetime.utcnow().isoformat())
SERVICE = DataService(CONNECTION, COMPANY_ID)


def _render_table(headers: Iterable[str], rows: Iterable[Iterable[str]]) -> str:
    header_html = "".join(f"<th>{header}</th>" for header in headers)
    row_html = "".join(
        "<tr>" + "".join(f"<td>{cell}</td>" for cell in row) + "</tr>" for row in rows
    )
    return (
        "<table border='1' cellpadding='6' cellspacing='0'>"
        f"<thead><tr>{header_html}</tr></thead><tbody>{row_html}</tbody></table>"
    )


def _page(title: str, body: str) -> HTMLResponse:
    html = f"""
    <html>
      <head>
        <title>{title}</title>
        <style>
          body {{ font-family: Arial, sans-serif; margin: 24px; }}
          h1 {{ margin-bottom: 8px; }}
          nav a {{ margin-right: 12px; }}
          table {{ margin-top: 12px; border-collapse: collapse; width: 100%; }}
          th {{ background: #f4f4f4; }}
          td, th {{ text-align: left; }}
        </style>
      </head>
      <body>
        <h1>{title}</h1>
        <nav>
          <a href="/">Dashboard</a>
          <a href="/accounts">Accounts</a>
          <a href="/transactions">Transactions</a>
          <a href="/budgets">Budgets</a>
          <a href="/reports">Reports</a>
          <a href="/inbox">Statements Inbox</a>
        </nav>
        <hr />
        {body}
      </body>
    </html>
    """
    return HTMLResponse(html)


@app.get("/", response_class=HTMLResponse)
def dashboard() -> HTMLResponse:
    accounts = SERVICE.list_accounts()
    transactions = SERVICE.list_transactions()
    budgets = SERVICE.list_budgets()
    documents = SERVICE.list_documents()
    body = (
        "<p>Preview mode for the local-first desktop bookkeeping app.</p>"
        "<ul>"
        f"<li>Accounts: {len(accounts)}</li>"
        f"<li>Transactions: {len(transactions)}</li>"
        f"<li>Budgets: {len(budgets)}</li>"
        f"<li>Documents: {len(documents)}</li>"
        "</ul>"
        "<p>Use the navigation links above to inspect each module.</p>"
    )
    return _page("Local Bookkeeping Preview", body)


@app.get("/accounts", response_class=HTMLResponse)
def accounts() -> HTMLResponse:
    rows = [
        (str(acc.id), acc.name, acc.type, "Yes" if acc.is_active else "No")
        for acc in SERVICE.list_accounts()
    ]
    body = _render_table(["ID", "Name", "Type", "Active"], rows)
    return _page("Chart of Accounts", body)


@app.get("/transactions", response_class=HTMLResponse)
def transactions() -> HTMLResponse:
    rows = [
        (
            str(txn.id),
            txn.txn_date,
            txn.vendor_name or "",
            txn.description or "",
            f"{txn.amount:.2f}",
            str(txn.account_id),
        )
        for txn in SERVICE.list_transactions()
    ]
    body = _render_table(["ID", "Date", "Vendor", "Description", "Amount", "Account"], rows)
    return _page("Transactions", body)


@app.get("/budgets", response_class=HTMLResponse)
def budgets() -> HTMLResponse:
    rows = [
        (str(budget.id), budget.month, f"{budget.amount:.2f}", str(budget.account_id))
        for budget in SERVICE.list_budgets()
    ]
    body = _render_table(["ID", "Month", "Amount", "Account"], rows)
    return _page("Budgets", body)


@app.get("/reports", response_class=HTMLResponse)
def reports() -> HTMLResponse:
    pnl_rows = SERVICE.profit_and_loss()
    pnl_table = _render_table(
        ["Type", "Month", "Total"],
        [(row["type"], row["month"], f"{row['total']:.2f}") for row in pnl_rows],
    )

    budget_rows = SERVICE.budget_vs_actual()
    budget_table = _render_table(
        ["Month", "Account", "Budget", "Actual"],
        [
            (
                row["month"],
                row["account_name"],
                f"{row['budgeted']:.2f}",
                f"{row['actual']:.2f}",
            )
            for row in budget_rows
        ],
    )

    category_rows = SERVICE.expense_by_category()
    category_table = _render_table(
        ["Category", "Total"],
        [(row["account_name"], f"{row['total']:.2f}") for row in category_rows],
    )

    vendor_rows = SERVICE.expense_by_vendor()
    vendor_table = _render_table(
        ["Vendor", "Total"],
        [(row["vendor_name"], f"{row['total']:.2f}") for row in vendor_rows],
    )

    body = (
        "<h2>Profit & Loss</h2>" + pnl_table +
        "<h2>Budget vs Actual</h2>" + budget_table +
        "<h2>Expenses by Category</h2>" + category_table +
        "<h2>Expenses by Vendor</h2>" + vendor_table
    )
    return _page("Reports", body)


@app.get("/inbox", response_class=HTMLResponse)
def inbox() -> HTMLResponse:
    rows = SERVICE.list_all_document_transactions()
    table = _render_table(
        ["Doc", "Date", "Vendor", "Description", "Amount", "Suggested", "Confidence", "Status"],
        [
            (
                str(row.document_id),
                row.txn_date or "",
                row.vendor_name or "",
                row.description or "",
                f"{row.amount:.2f}" if row.amount is not None else "",
                str(row.suggested_account_id or ""),
                f"{(row.confidence or 0) * 100:.0f}%",
                row.status,
            )
            for row in rows
        ],
    )
    return _page("Statements Inbox", table)
