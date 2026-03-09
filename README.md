# LedgerLocal - Secure Local-First Bookkeeping

A modern, local-first bookkeeping desktop application. Your financial data stays on YOUR machine.

## What It Does

- **Dashboard** - Visual overview of income, expenses, net income, trends
- **Chart of Accounts** - Create, edit, archive accounts (income, expense, asset, liability)
- **Transactions** - Manual entry, search, filter, bulk recategorize
- **Budgets** - Set monthly budgets per account, track budget vs actual
- **Reports** - Profit & Loss, Expense by Category/Vendor, Monthly Trends, Balance Sheet
- **Statement Inbox** - Drag & drop PDF bank statements, auto-extract transactions
- **Smart Categorization** - Rules-based + learned vendor mappings
- **Settings** - Company info, categorization rules, backup/restore

## Quick Start

### Prerequisites
- Python 3.10+ 
- Node.js 18+ (only for development)

### Run the App

```bash
# 1. Install Python dependencies
cd backend
pip install -r requirements.txt

# 2. Build the frontend (first time only)
cd ../frontend
npm install
npm run build

# 3. Start the app
cd ../backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 4. Open in your browser
# Go to http://localhost:8000
```

### For Development

```bash
# Terminal 1: Backend
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2: Frontend
cd frontend
npm install
npm run dev
```

## Architecture

```
Python (FastAPI) Backend  <-->  React Frontend
        |                           |
   SQLite Database           Charts (Recharts)
   (local file)              Tailwind CSS
   PDF Parser                React Router
   Smart Categorization
```

**Why this stack?**
- **Python**: Best PDF/OCR libraries, easy to maintain
- **FastAPI**: Fast, modern API framework
- **React**: Modern UI with great charting libraries
- **SQLite**: Zero-config, local-first, reliable database
- **Tailwind CSS**: Clean, professional design

## Project Structure

```
webapp/
  backend/
    app/
      main.py              # FastAPI application entry
      database.py           # SQLite schema & connection
      models.py             # Pydantic API models
      main_state.py         # App state management
      routers/
        accounts.py         # Chart of Accounts API
        transactions.py     # Transactions API
        budgets.py          # Budgets API
        reports.py          # Reports & Dashboard API
        documents.py        # PDF Inbox API
        settings.py         # Settings & Backup API
      services/
        data_service.py     # Core database operations
        categorization.py   # Smart categorization engine
        pdf_parser.py       # PDF statement parser
        seed_data.py        # Demo data seeding
    tests/
      test_core.py          # 21 backend tests
    requirements.txt
  frontend/
    src/
      api/client.js         # API client
      components/Layout.jsx # App layout & navigation
      pages/
        Dashboard.jsx       # Dashboard with charts
        Accounts.jsx        # Chart of Accounts CRUD
        Transactions.jsx    # Transaction management
        Budgets.jsx         # Budget tracking
        Reports.jsx         # Financial reports
        Inbox.jsx           # PDF statement inbox
        Settings.jsx        # App settings
    package.json
    vite.config.js
    tailwind.config.js
```

## Running Tests

```bash
cd backend
python -m pytest tests/ -v
```

## Building for Windows

### Option 1: Simple Launcher (Recommended for now)
Create a `.bat` file on your desktop:
```batch
@echo off
cd /d "C:\path\to\webapp\backend"
start http://localhost:8000
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### Option 2: PyInstaller (Standalone .exe)
```bash
pip install pyinstaller
cd backend
pyinstaller --onefile --add-data "../frontend/dist;frontend/dist" app/main.py
```

## Security & Privacy

- All data stored locally in `company_data/ledgerlocal.db`
- No cloud sync, no external API calls
- SQLite with WAL mode for data integrity
- Manual backup/restore support
- Audit trail for all changes

## Database

- **SQLite** with WAL (Write-Ahead Logging)
- Stored at: `backend/company_data/ledgerlocal.db`
- Tables: company, accounts, vendors, transactions, budgets, documents, document_transactions, categorization_rules, vendor_account_map, audit_log

## Sample Data

The app comes pre-loaded with 9 months of realistic demo data including:
- 18 accounts across income, expense, asset, liability
- 600+ transactions with realistic vendors and amounts
- Monthly budgets for all expense accounts
- 19 categorization rules

## License

Private - All rights reserved.
