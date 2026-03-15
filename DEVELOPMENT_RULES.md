# LocalBookKeeping — Development Rules

These rules apply to ALL contributors and AI agents working on this project.

## 🔨 Build Verification (MANDATORY)

**After every code change or fix, run the build before considering a task complete.**

### Frontend Build
```bash
cd frontend && npm run build
```

### Backend Syntax Check
```bash
cd backend && python -m py_compile app/routers/reports.py app/routers/budgets.py app/services/data_service.py app/models.py app/main.py
```

Both must pass with zero errors. Fix any errors before marking a task as done.

---

## 📦 Full Installer Build

**To create the distributable Windows installer:**

```bash
build.bat
```

This produces `backend\dist\LocalBooks_Setup.exe` — a single-file installer that users download and run.

The build process:
1. Generates demo data (Chase/RBC statements)
2. Builds the React frontend
3. Bundles the app with PyInstaller (onedir mode)
4. Zips the bundle and creates a single-file bootstrapper installer

**Note:** The build can take several minutes to complete.

---

##  Terminology

| Term | Meaning |
|------|---------|
| **Account** | A top-level bank account or credit card (e.g., "Chase Business Checking") |
| **Category** | A sub-account used to categorize transactions (e.g., "Office Supplies", "Sales Revenue") |

Use these terms consistently across all UI labels, API responses, documentation, and code comments.

---

## 💰 Accounting Rules

- The Balance Sheet must always satisfy: **Assets = Liabilities + Equity**
- Retained Earnings (Net Income) is an **Equity** item, never an Asset
- Historical records (transactions, budgets for past months) are **read-only** — never allow modification of past data
- Budget changes apply to the **current month and future months only**

---

## 🗂️ Project Structure

- **Backend:** FastAPI + SQLite — `backend/`
- **Frontend:** React + Vite + TailwindCSS — `frontend/`
- **Routers:** `backend/app/routers/`
- **Services:** `backend/app/services/`
- **Pages:** `frontend/src/pages/`
- **Components:** `frontend/src/components/`
- **Docs:** `docs/`

---

## 🔁 Workflow for Every Fix

1. Read and understand the relevant files before changing anything
2. Make targeted, minimal changes
3. **Run the build** (frontend + backend)
4. Fix any build errors
5. Use `attempt_completion` with a clear summary of what changed and why
