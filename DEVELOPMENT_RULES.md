# LocalBookKeeping — Development Rules

These rules apply to ALL contributors and AI agents working on this project.

## 🛡️ Database Preservation Rules (CRITICAL)

**NEVER wipe, drop, or delete the existing database during app updates or startup.**

1. **No destructive schema changes**: Always use `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN` (with existence checks), and additive migrations. Never use `DROP TABLE` or `DELETE FROM` on user data.
2. **Preserve all companies**: All companies including the Demo Company must be preserved during updates. Never delete company data as part of the update process.
3. **Backup before any destructive operation**: If a destructive operation is absolutely necessary, always create a backup first AND restore it after.
4. **Seed data is idempotent**: Seed functions must check for existing data and skip if present. Never blindly insert seed data.
5. **Build process is separate from runtime**: `build_golden_copy.py` may wipe and recreate the bundled database for builds, but this must NEVER affect the user's runtime database.
6. **Bootstrapper must preserve user data**: The installer bootstrapper must backup the database before removing the install directory and restore it after extraction. It must NOT delete any company data (including Demo Company) from the restored database.
7. **`ensure_company()` must be name-specific**: The function must check for a company by name, not just return the first company found.
8. **`build_golden_copy.py` must never run against a database with user data** unless `--force` is explicitly passed. The script always creates a backup before deleting. It is for building the bundled demo DB only — never run it against a production or dev database with real company data.
9. **Dev and installed app databases are separate files.** The dev DB lives at `backend/company_data/ledgerlocal.db`; the installed app DB lives at `Documents\LocalBooks\company_data\ledgerlocal.db`. Changes to one do not affect the other.
10. **Dev-mode auto-recovery.** When the dev server starts and the dev DB is missing or demo-only, it automatically copies the installed app's database (if it exists and contains user data). This ensures the dev server always shows real user data. The previous dev DB is backed up to `company_data/backups/` before overwriting.

---

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

## 📦 Full Installer Build (MANDATORY)

**After completing ANY code changes (backend or frontend), always run the full build process:**

```bash
build.bat
```

This produces `backend\dist\LocalBooks_Setup.exe` — a single-file installer that users download and run.

The build process:
1. Generates demo data (Chase/RBC statements)
2. Builds the React frontend
3. Bundles the app with PyInstaller (onedir mode)
4. Zips the bundle and creates a single-file bootstrapper installer

**The build must succeed with zero errors before a task is considered complete.** Do not skip this step — the user should never have to manually trigger builds.

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
3. **Run `build.bat`** from the project root (covers both frontend and backend)
4. Fix any build errors — the build must succeed before the task is complete
5. Use `attempt_completion` with a clear summary of what changed and why
