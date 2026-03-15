# LedgerLocal / LocalBooks - Project Brief

## 1. Overall Goal and Purpose

**LedgerLocal** (also referred to as **LocalBooks** in the codebase) is a **local-first bookkeeping desktop application** designed for small businesses. The core philosophy is that your financial data stays on YOUR machine - no cloud storage, no subscription fees, complete privacy.

### What It Does
- **Dashboard** - Visual overview of income, expenses, net income, and trends with charts
- **Chart of Accounts** - Create, edit, and archive accounts (income, expense, asset, liability types)
- **Transactions** - Manual entry, search, filter, and bulk recategorization
- **Budgets** - Set monthly budgets per account and track budget vs. actual spending
- **Reports** - Profit & Loss, Expense by Category/Vendor, Monthly Trends, Balance Sheet
- **Statement Inbox** - Drag & drop PDF bank statements to auto-extract transactions
- **Smart Categorization** - Rules-based + learned vendor mappings to automatically categorize transactions
- **Settings** - Company info, categorization rules, backup/restore functionality

### Target Users
Small business owners who want a simple, secure, desktop-based bookkeeping solution without relying on cloud services like QuickBooks Online.

---

## 2. High-Level Tech Stack Overview

### Backend (Python)
| Component | Technology | Purpose |
|-----------|------------|---------|
| Web Framework | **FastAPI** | Modern, fast API framework for building the REST API |
| Database | **SQLite** | Local, zero-config database for storing all financial data |
| PDF Parsing | **pdfplumber** + **pytesseract (OCR)** | Extracts transactions from PDF bank statements |
| Server | **Uvicorn** | ASGI server to run the FastAPI application |
| Testing | **pytest** | Unit and integration tests |
| Packaging | **PyInstaller** | Creates standalone Windows executable (.exe) |

**Backend Structure:**
```
backend/
├── app/
│   ├── main.py           # FastAPI entry point, serves static frontend
│   ├── database.py       # SQLite schema & connection management
│   ├── models.py         # Pydantic API models
│   ├── main_state.py     # Application state management
│   ├── routers/          # API endpoints (accounts, transactions, etc.)
│   └── services/         # Business logic (PDF parsing, categorization, etc.)
├── tests/                # Backend test suite
└── requirements.txt      # Python dependencies
```

### Frontend (JavaScript/React)
| Component | Technology | Purpose |
|-----------|------------|---------|
| Framework | **React 19** | Modern UI library for building the interface |
| Build Tool | **Vite 7** | Fast development server and production build |
| Styling | **Tailwind CSS 3** | Utility-first CSS framework for professional design |
| Routing | **React Router 6** | Client-side navigation between pages |
| Charts | **Recharts** | Data visualization for dashboard and reports |
| Icons | **Lucide React** | Modern icon library |
| Date Handling | **date-fns** | Date manipulation and formatting |
| CSV/Excel | **PapaParse** + **xlsx** | Import/export functionality |

**Frontend Structure:**
```
frontend/
├── src/
│   ├── App.jsx           # Main app component with routing
│   ├── main.jsx          # React entry point
│   ├── api/client.js     # API communication layer
│   ├── components/       # Reusable UI components
│   ├── pages/            # Page components (Dashboard, Accounts, etc.)
│   └── context/          # React context for state management
├── package.json          # Node.js dependencies
└── vite.config.js        # Vite configuration with proxy
```

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    User's Computer                          │
│                                                             │
│  ┌─────────────────┐        ┌─────────────────────────┐    │
│  │   Browser       │◄──────►│   Python Backend        │    │
│  │   (React App)   │  HTTP  │   (FastAPI + Uvicorn)   │    │
│  │                 │        │   Port: 8000            │    │
│  └─────────────────┘        └───────────┬─────────────┘    │
│          ▲                                │                 │
│          │                                │                 │
│          │                           ┌────┴────┐            │
│          │                           │ SQLite  │            │
│          │                           │Database │            │
│          │                           │ (.db)   │            │
│          │                           └─────────┘            │
│          │                                                  │
│          │         ┌─────────────────┐                     │
│          └─────────┤ PDF Bank        │                     │
│                    │ Statements      │                     │
│                    └─────────────────┘                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Commands to Start the Application

### Quick Start (Production Mode)

**Option A: Using the start.bat script (Windows)**
```batch
# In the project root directory
double-click start.bat
# or from Command Prompt:
start.bat
```
This script will:
1. Check if Python is installed
2. Install dependencies (first run only)
3. Build the frontend (first run only)
4. Start the server and open your browser

**Option B: Manual commands**
```bash
# 1. Install Python dependencies (first time only)
cd backend
pip install -r requirements.txt

# 2. Build the frontend (first time only)
cd ../frontend
npm install
npm run build

# 3. Start the backend server
cd ../backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 4. Open your browser and go to:
# http://localhost:8000
```

### Development Mode (Hot Reload)

You need **two terminals** running simultaneously:

**Terminal 1 - Backend:**
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm install
npm run dev
```

Then open: http://localhost:5173 (frontend dev server, which proxies API calls to port 8000)

### Prerequisites
- **Python 3.10+** - Download from https://python.org
- **Node.js 18+** - Download from https://nodejs.org (only needed for development)

---

## 4. Technical Issues and Observations

### ⚠️ Immediate Issues Noticed

1. **Database Filename Inconsistency**
   - The code uses both `ledgerlocal.db` and `localbooks.db` in different places
   - In `main.py`: The bundled database is `ledgerlocal.db` but the runtime DB is `localbooks.db`
   - **Impact**: Could cause confusion or data not being found
   - **Fix**: Standardize on one filename throughout the codebase

2. **PyInstaller Build Requirements**
   - The `build.bat` script builds the app into a Windows executable
   - This requires PyInstaller which may not be installed
   - The built executables exist in `backend/build/` but appear incomplete (no `dist/` folder shown)

3. **Missing `.gitignore` in Backend**
   - Python cache files (`__pycache__`, `.pyc` files) and virtual environments should be excluded
   - Build artifacts in `backend/build/` and `backend/dist/` should be ignored

4. **Tesseract OCR Dependency**
   - The PDF parser uses `pytesseract` which requires the Tesseract OCR engine to be installed separately on the system
   - Without it, OCR fallback for scanned PDFs won't work
   - **Installation**: Users need to install Tesseract from https://github.com/UB-Mannheim/tesseract/wiki

5. **Frontend Build Output Location**
   - The backend expects the frontend at `../frontend/dist` in development mode
   - If the frontend hasn't been built, the backend won't serve the UI properly
   - The `start.bat` handles this, but manual startup requires remembering to build first

### 📋 Observations

1. **Well-Structured Codebase**
   - Clear separation between backend routers and services
   - Frontend follows modern React patterns with functional components
   - Good test coverage in `backend/tests/`

2. **Security-Conscious Design**
   - Local-first approach keeps data private
   - No external API dependencies for core functionality
   - Uses parameterized SQL queries (prevents SQL injection)

3. **PDF Parser is Sophisticated**
   - Supports 30+ bank formats (Chase, Bank of America, Wells Fargo, etc.)
   - Has both text extraction and OCR fallback
   - Uses regex patterns for bank detection

4. **Windows-Focused**
   - Uses Windows batch files (`.bat`) for automation
   - Uses Windows MessageBox for error display in the packaged app
   - Targets Windows users primarily

### 🔧 Recommended Next Steps

1. Run `start.bat` to verify the application starts correctly
2. If developing, ensure both Python and Node.js are installed
3. Install Tesseract OCR if you plan to import scanned PDF bank statements
4. Consider standardizing the database filename if planning to distribute the app
