from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

from PySide6 import QtCore, QtWidgets

from app.services.categorization import suggest_account
from app.services.data_service import DataService, DocumentTransactionRecord
from app.services.pdf_ingest import parse_pdf


@dataclass
class AccountOption:
    id: int
    name: str
    type: str


class AccountsTab(QtWidgets.QWidget):
    def __init__(self, data_service: DataService) -> None:
        super().__init__()
        self.data_service = data_service
        self.table = QtWidgets.QTableWidget()
        self.name_input = QtWidgets.QLineEdit()
        self.type_input = QtWidgets.QComboBox()
        self.type_input.addItems(["income", "expense", "asset", "liability"])
        self.add_button = QtWidgets.QPushButton("Add Account")

        form = QtWidgets.QFormLayout()
        form.addRow("Name", self.name_input)
        form.addRow("Type", self.type_input)
        form.addRow(self.add_button)

        layout = QtWidgets.QVBoxLayout(self)
        layout.addLayout(form)
        layout.addWidget(self.table)

        self.add_button.clicked.connect(self.add_account)
        self.refresh()

    def refresh(self) -> None:
        accounts = self.data_service.list_accounts()
        self.table.setRowCount(len(accounts))
        self.table.setColumnCount(4)
        self.table.setHorizontalHeaderLabels(["ID", "Name", "Type", "Active"])
        for row_index, account in enumerate(accounts):
            self.table.setItem(row_index, 0, QtWidgets.QTableWidgetItem(str(account.id)))
            self.table.setItem(row_index, 1, QtWidgets.QTableWidgetItem(account.name))
            self.table.setItem(row_index, 2, QtWidgets.QTableWidgetItem(account.type))
            self.table.setItem(row_index, 3, QtWidgets.QTableWidgetItem("Yes" if account.is_active else "No"))
        self.table.resizeColumnsToContents()

    def add_account(self) -> None:
        name = self.name_input.text().strip()
        account_type = self.type_input.currentText()
        if not name:
            return
        self.data_service.add_account(name, account_type, None)
        self.name_input.clear()
        self.refresh()


class TransactionsTab(QtWidgets.QWidget):
    def __init__(self, data_service: DataService) -> None:
        super().__init__()
        self.data_service = data_service
        self.table = QtWidgets.QTableWidget()
        self.date_input = QtWidgets.QDateEdit(QtCore.QDate.currentDate())
        self.date_input.setDisplayFormat("yyyy-MM-dd")
        self.vendor_input = QtWidgets.QLineEdit()
        self.description_input = QtWidgets.QLineEdit()
        self.amount_input = QtWidgets.QDoubleSpinBox()
        self.amount_input.setMaximum(1_000_000_000)
        self.account_input = QtWidgets.QComboBox()
        self.add_button = QtWidgets.QPushButton("Add Transaction")

        form = QtWidgets.QFormLayout()
        form.addRow("Date", self.date_input)
        form.addRow("Vendor", self.vendor_input)
        form.addRow("Description", self.description_input)
        form.addRow("Amount", self.amount_input)
        form.addRow("Account", self.account_input)
        form.addRow(self.add_button)

        layout = QtWidgets.QVBoxLayout(self)
        layout.addLayout(form)
        layout.addWidget(self.table)

        self.add_button.clicked.connect(self.add_transaction)
        self.refresh()

    def refresh(self) -> None:
        self._load_accounts()
        transactions = self.data_service.list_transactions()
        self.table.setRowCount(len(transactions))
        self.table.setColumnCount(6)
        self.table.setHorizontalHeaderLabels(["ID", "Date", "Vendor", "Description", "Amount", "Account ID"])
        for row_index, txn in enumerate(transactions):
            self.table.setItem(row_index, 0, QtWidgets.QTableWidgetItem(str(txn.id)))
            self.table.setItem(row_index, 1, QtWidgets.QTableWidgetItem(txn.txn_date))
            self.table.setItem(row_index, 2, QtWidgets.QTableWidgetItem(txn.vendor_name or ""))
            self.table.setItem(row_index, 3, QtWidgets.QTableWidgetItem(txn.description or ""))
            self.table.setItem(row_index, 4, QtWidgets.QTableWidgetItem(f"{txn.amount:.2f}"))
            self.table.setItem(row_index, 5, QtWidgets.QTableWidgetItem(str(txn.account_id)))
        self.table.resizeColumnsToContents()

    def _load_accounts(self) -> None:
        accounts = self.data_service.list_accounts()
        self.account_input.clear()
        for account in accounts:
            self.account_input.addItem(f"{account.name} ({account.type})", account.id)

    def add_transaction(self) -> None:
        account_id = self.account_input.currentData()
        if account_id is None:
            return
        self.data_service.add_transaction(
            txn_date=self.date_input.date().toString("yyyy-MM-dd"),
            description=self.description_input.text().strip(),
            amount=float(self.amount_input.value()),
            vendor_name=self.vendor_input.text().strip(),
            account_id=int(account_id),
        )
        self.vendor_input.clear()
        self.description_input.clear()
        self.amount_input.setValue(0)
        self.refresh()


class BudgetsTab(QtWidgets.QWidget):
    def __init__(self, data_service: DataService) -> None:
        super().__init__()
        self.data_service = data_service
        self.table = QtWidgets.QTableWidget()
        self.month_input = QtWidgets.QDateEdit(QtCore.QDate.currentDate())
        self.month_input.setDisplayFormat("yyyy-MM")
        self.account_input = QtWidgets.QComboBox()
        self.amount_input = QtWidgets.QDoubleSpinBox()
        self.amount_input.setMaximum(1_000_000_000)
        self.save_button = QtWidgets.QPushButton("Save Budget")

        form = QtWidgets.QFormLayout()
        form.addRow("Month", self.month_input)
        form.addRow("Account", self.account_input)
        form.addRow("Amount", self.amount_input)
        form.addRow(self.save_button)

        layout = QtWidgets.QVBoxLayout(self)
        layout.addLayout(form)
        layout.addWidget(self.table)

        self.save_button.clicked.connect(self.save_budget)
        self.refresh()

    def refresh(self) -> None:
        self._load_accounts()
        budgets = self.data_service.list_budgets()
        self.table.setRowCount(len(budgets))
        self.table.setColumnCount(4)
        self.table.setHorizontalHeaderLabels(["ID", "Month", "Amount", "Account ID"])
        for row_index, budget in enumerate(budgets):
            self.table.setItem(row_index, 0, QtWidgets.QTableWidgetItem(str(budget.id)))
            self.table.setItem(row_index, 1, QtWidgets.QTableWidgetItem(budget.month))
            self.table.setItem(row_index, 2, QtWidgets.QTableWidgetItem(f"{budget.amount:.2f}"))
            self.table.setItem(row_index, 3, QtWidgets.QTableWidgetItem(str(budget.account_id)))
        self.table.resizeColumnsToContents()

    def _load_accounts(self) -> None:
        accounts = self.data_service.list_accounts()
        self.account_input.clear()
        for account in accounts:
            self.account_input.addItem(f"{account.name} ({account.type})", account.id)

    def save_budget(self) -> None:
        account_id = self.account_input.currentData()
        if account_id is None:
            return
        self.data_service.upsert_budget(
            month=self.month_input.date().toString("yyyy-MM"),
            amount=float(self.amount_input.value()),
            account_id=int(account_id),
        )
        self.amount_input.setValue(0)
        self.refresh()


class ReportsTab(QtWidgets.QWidget):
    def __init__(self, data_service: DataService) -> None:
        super().__init__()
        self.data_service = data_service
        self.tabs = QtWidgets.QTabWidget()
        self.pnl_table = QtWidgets.QTableWidget()
        self.budget_table = QtWidgets.QTableWidget()
        self.expense_category_table = QtWidgets.QTableWidget()
        self.expense_vendor_table = QtWidgets.QTableWidget()

        self.tabs.addTab(self.pnl_table, "Profit & Loss")
        self.tabs.addTab(self.budget_table, "Budget vs Actual")
        self.tabs.addTab(self.expense_category_table, "Expenses by Category")
        self.tabs.addTab(self.expense_vendor_table, "Expenses by Vendor")

        layout = QtWidgets.QVBoxLayout(self)
        layout.addWidget(self.tabs)

        self.refresh()

    def refresh(self) -> None:
        pnl = self.data_service.profit_and_loss()
        self.pnl_table.setRowCount(len(pnl))
        self.pnl_table.setColumnCount(3)
        self.pnl_table.setHorizontalHeaderLabels(["Type", "Month", "Total"])
        for row_index, row in enumerate(pnl):
            self.pnl_table.setItem(row_index, 0, QtWidgets.QTableWidgetItem(row["type"]))
            self.pnl_table.setItem(row_index, 1, QtWidgets.QTableWidgetItem(row["month"]))
            self.pnl_table.setItem(row_index, 2, QtWidgets.QTableWidgetItem(f"{row['total']:.2f}"))
        self.pnl_table.resizeColumnsToContents()

        budget_rows = self.data_service.budget_vs_actual()
        self.budget_table.setRowCount(len(budget_rows))
        self.budget_table.setColumnCount(4)
        self.budget_table.setHorizontalHeaderLabels(["Month", "Account", "Budget", "Actual"])
        for row_index, row in enumerate(budget_rows):
            self.budget_table.setItem(row_index, 0, QtWidgets.QTableWidgetItem(row["month"]))
            self.budget_table.setItem(row_index, 1, QtWidgets.QTableWidgetItem(row["account_name"]))
            self.budget_table.setItem(row_index, 2, QtWidgets.QTableWidgetItem(f"{row['budgeted']:.2f}"))
            self.budget_table.setItem(row_index, 3, QtWidgets.QTableWidgetItem(f"{row['actual']:.2f}"))
        self.budget_table.resizeColumnsToContents()

        category_rows = self.data_service.expense_by_category()
        self.expense_category_table.setRowCount(len(category_rows))
        self.expense_category_table.setColumnCount(2)
        self.expense_category_table.setHorizontalHeaderLabels(["Category", "Total"])
        for row_index, row in enumerate(category_rows):
            self.expense_category_table.setItem(row_index, 0, QtWidgets.QTableWidgetItem(row["account_name"]))
            self.expense_category_table.setItem(row_index, 1, QtWidgets.QTableWidgetItem(f"{row['total']:.2f}"))
        self.expense_category_table.resizeColumnsToContents()

        vendor_rows = self.data_service.expense_by_vendor()
        self.expense_vendor_table.setRowCount(len(vendor_rows))
        self.expense_vendor_table.setColumnCount(2)
        self.expense_vendor_table.setHorizontalHeaderLabels(["Vendor", "Total"])
        for row_index, row in enumerate(vendor_rows):
            self.expense_vendor_table.setItem(row_index, 0, QtWidgets.QTableWidgetItem(row["vendor_name"]))
            self.expense_vendor_table.setItem(row_index, 1, QtWidgets.QTableWidgetItem(f"{row['total']:.2f}"))
        self.expense_vendor_table.resizeColumnsToContents()


class InboxTab(QtWidgets.QWidget):
    def __init__(self, data_service: DataService, base_dir: Path, account_options: List[AccountOption]):
        super().__init__()
        self.data_service = data_service
        self.base_dir = base_dir
        self.account_options = account_options
        self.document_table = QtWidgets.QTableWidget()
        self.import_button = QtWidgets.QPushButton("Import PDFs")
        self.post_button = QtWidgets.QPushButton("Post Selected")

        layout = QtWidgets.QVBoxLayout(self)
        layout.addWidget(self.import_button)
        layout.addWidget(self.document_table)
        layout.addWidget(self.post_button)

        self.import_button.clicked.connect(self.import_pdfs)
        self.post_button.clicked.connect(self.post_selected)

        self.refresh([])

    def refresh(self, rows: List[DocumentTransactionRecord]) -> None:
        self.document_table.setRowCount(len(rows))
        self.document_table.setColumnCount(8)
        self.document_table.setHorizontalHeaderLabels(
            ["Select", "Date", "Vendor", "Description", "Amount", "Suggested Account", "Confidence", "Doc ID"]
        )
        for row_index, row in enumerate(rows):
            checkbox = QtWidgets.QTableWidgetItem()
            checkbox.setCheckState(QtCore.Qt.CheckState.Checked)
            self.document_table.setItem(row_index, 0, checkbox)
            self.document_table.setItem(row_index, 1, QtWidgets.QTableWidgetItem(row.txn_date or ""))
            self.document_table.setItem(row_index, 2, QtWidgets.QTableWidgetItem(row.vendor_name or ""))
            self.document_table.setItem(row_index, 3, QtWidgets.QTableWidgetItem(row.description or ""))
            self.document_table.setItem(row_index, 4, QtWidgets.QTableWidgetItem(f"{row.amount:.2f}"))
            suggested_name = self._account_name(row.suggested_account_id)
            self.document_table.setItem(row_index, 5, QtWidgets.QTableWidgetItem(suggested_name))
            confidence_text = f"{(row.confidence or 0) * 100:.0f}%"
            self.document_table.setItem(row_index, 6, QtWidgets.QTableWidgetItem(confidence_text))
            self.document_table.setItem(row_index, 7, QtWidgets.QTableWidgetItem(str(row.document_id)))
        self.document_table.resizeColumnsToContents()

    def _account_name(self, account_id: Optional[int]) -> str:
        for option in self.account_options:
            if option.id == account_id:
                return option.name
        return "Uncategorized"

    def import_pdfs(self) -> None:
        files, _ = QtWidgets.QFileDialog.getOpenFileNames(
            self,
            "Select PDF statements",
            str(self.base_dir),
            "PDF Files (*.pdf)",
        )
        if not files:
            return
        all_rows: List[DocumentTransactionRecord] = []
        for file_path in files:
            path = Path(file_path)
            doc_id = self.data_service.add_document(path.name, str(path))
            parsed = parse_pdf(path)
            rows: List[DocumentTransactionRecord] = []
            for entry in parsed:
                account_id, confidence = suggest_account(
                    self.data_service.connection,
                    self.data_service.company_id,
                    entry.description,
                    entry.vendor_name,
                )
                rows.append(
                    DocumentTransactionRecord(
                        id=0,
                        document_id=doc_id,
                        txn_date=entry.txn_date,
                        description=entry.description,
                        amount=entry.amount,
                        vendor_name=entry.vendor_name,
                        suggested_account_id=account_id,
                        confidence=confidence,
                        status="review",
                    )
                )
            if rows:
                self.data_service.add_document_transactions(doc_id, rows)
                all_rows.extend(self.data_service.list_document_transactions(doc_id))
        self.refresh(all_rows)

    def post_selected(self) -> None:
        for row_index in range(self.document_table.rowCount()):
            if self.document_table.item(row_index, 0).checkState() != QtCore.Qt.CheckState.Checked:
                continue
            date = self.document_table.item(row_index, 1).text()
            vendor = self.document_table.item(row_index, 2).text()
            description = self.document_table.item(row_index, 3).text()
            amount_text = self.document_table.item(row_index, 4).text()
            account_name = self.document_table.item(row_index, 5).text()
            account_id = None
            for option in self.account_options:
                if option.name == account_name:
                    account_id = option.id
                    break
            if account_id is None:
                continue
            self.data_service.add_transaction(
                txn_date=date,
                description=description,
                amount=float(amount_text),
                vendor_name=vendor,
                account_id=account_id,
            )
        QtWidgets.QMessageBox.information(self, "Posted", "Selected transactions were posted.")


class MainWindow(QtWidgets.QMainWindow):
    def __init__(self, data_service: DataService, base_dir: Path) -> None:
        super().__init__()
        self.data_service = data_service
        self.base_dir = base_dir
        self.setWindowTitle("Local Bookkeeping")
        self.resize(1200, 800)

        self.tabs = QtWidgets.QTabWidget()
        self.accounts_tab = AccountsTab(data_service)
        self.transactions_tab = TransactionsTab(data_service)
        self.budgets_tab = BudgetsTab(data_service)
        self.reports_tab = ReportsTab(data_service)
        self.inbox_tab = InboxTab(data_service, base_dir, self._account_options())

        self.tabs.addTab(self.accounts_tab, "Chart of Accounts")
        self.tabs.addTab(self.transactions_tab, "Transactions")
        self.tabs.addTab(self.budgets_tab, "Budgets")
        self.tabs.addTab(self.reports_tab, "Reports")
        self.tabs.addTab(self.inbox_tab, "Statements Inbox")

        self.setCentralWidget(self.tabs)

    def _account_options(self) -> List[AccountOption]:
        return [AccountOption(id=acc.id, name=acc.name, type=acc.type) for acc in self.data_service.list_accounts()]

    def refresh_all(self) -> None:
        self.accounts_tab.refresh()
        self.transactions_tab.refresh()
        self.budgets_tab.refresh()
        self.reports_tab.refresh()
        self.inbox_tab.account_options = self._account_options()
