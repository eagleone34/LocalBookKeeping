# ADR-001: Technology Stack Selection

**Date:** 2026-03-30
**Status:** Accepted
**Deciders:** Founding Engineer

---

## Context

LedgerLocal is a local-first bookkeeping desktop app for small businesses. The core constraints are:

- All data must remain on the user's machine (no cloud)
- Distributable as a single-click executable (Windows primary target)
- Self-updating via GitHub releases
- Small team, fast iteration

The initial evaluation considered two main paths:

| Option | Stack |
|---|---|
| A | Electron + React + SQLite |
| B | Tauri + React + SQLite |
| C (chosen) | PyInstaller + FastAPI + React + SQLite |

---

## Decision

**Option C — PyInstaller-bundled FastAPI backend + React frontend served locally.**

The app packages as a single Windows `.exe` via PyInstaller. At runtime:
- The executable launches a FastAPI/Uvicorn server on `127.0.0.1:8000`
- The frontend (built React/Vite SPA) is embedded in the bundle and served as static files
- SQLite database lives at a user-writable path alongside the executable
- The user's default browser opens automatically to `http://localhost:8000`

---

## Rationale

### Why not Electron or Tauri?

| Criterion | Electron | Tauri | PyInstaller + FastAPI |
|---|---|---|---|
| Bundle size | ~150 MB (ships Chromium) | ~5 MB (uses system WebView) | ~30–50 MB |
| PDF parsing | Requires native bindings or subprocess | Same issue | Native Python libs (pdfplumber, pytesseract) |
| SQLite | `better-sqlite3` (works well) | `rusqlite` (works well) | Python `sqlite3` stdlib |
| Dev familiarity | JS/TS full-stack | Rust required for backend | Python backend devs most common for data apps |
| OCR integration | Complex | Complex | `pytesseract` drops in trivially |
| Windows packaging | `electron-builder` | `tauri-bundler` | PyInstaller, well-understood |

The PDF bank statement parser is a first-class feature. Python's `pdfplumber` and `pytesseract` libraries are mature, well-documented, and integrate trivially. Replicating this in Node.js or Rust would require significant additional work.

### Why SQLite?

- Zero configuration — no server process, no install step
- Entire database is one file users can backup by copying
- More than sufficient for single-user bookkeeping volumes
- Parameterized queries throughout prevent SQL injection

### Why React + Vite?

- Standard, widely understood UI stack
- Vite provides fast dev builds with hot-reload
- Tailwind CSS enables rapid, consistent styling
- Recharts covers all required chart types

---

## Data Model Summary

Core tables (defined in `backend/app/database.py`):

| Table | Purpose |
|---|---|
| `company` | Company info, currency, fiscal year settings |
| `accounts` | Chart of accounts (income, expense, asset, liability, equity) |
| `vendors` | Payee/vendor master (learned from transactions) |
| `transactions` | Core ledger — date, account, vendor, amount, source |
| `budgets` | Monthly budget targets per account |
| `documents` | Uploaded PDF bank statements |
| `bank_accounts` | Bank account registry for statement reconciliation |
| `document_transactions` | Staging table for parsed transactions pre-confirmation |
| `categorization_rules` | User-defined rules for auto-categorization |
| `vendor_account_mappings` | Learned vendor → account mappings |
| `reconciliations` | Reconciliation sessions |

---

## Update Mechanism

The executable checks GitHub Releases on startup via the GitHub API. If a newer version tag is found, it downloads the new `.exe` to a temp location and prompts the user to restart. This avoids requiring an installer — users can distribute via a single file URL.

---

## Consequences

- **Positive:** Rapid PDF parser iteration, no WebView compatibility issues, familiar Python stack
- **Positive:** Single `.exe` distribution, no install step for end users
- **Negative:** Users must allow an unknown executable through Windows Defender (standard for non-signed apps)
- **Negative:** Auto-update requires re-download of entire bundle (~50 MB) on each release
- **Accepted risk:** Browser-based UI means the app is technically accessible to other local processes on port 8000; mitigated by binding only to `127.0.0.1`
