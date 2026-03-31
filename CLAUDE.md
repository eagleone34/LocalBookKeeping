# LocalBookKeeping (LedgerLocal / LocalBooks)

Local-first desktop bookkeeping app for small businesses. No cloud. Single `.exe` distributable.
**Stack:** FastAPI + SQLite (backend) · React 19 / Vite / Tailwind (frontend) · PyInstaller (packaging)

---

## How Claude Operates

The user gives instructions. Claude handles everything else.

1. **Read this file first**, then load the relevant context before starting any task
2. **Never ask the user which files to read** — determine context independently based on the task
3. **For full-stack or unclear scope**, load broadly then narrow
4. **Check memory first** — read `MEMORY.md` at session start; relevant memories surface non-obvious decisions and known issues
5. **When in doubt about a rule**, check `DEVELOPMENT_RULES.md` and `docs/financial-accuracy-rules.md` before asking

---

## Auto-Memory Triggers

When the user states any of the following, **write to memory immediately — before executing the task — without being asked**:

| What the user says | Memory type | Write to |
|---|---|---|
| "don't forget to X" / "always remember to X" / "every time we do Y, do X" | feedback | `memory/feedback.md` |
| "from now on X" / "going forward X" / "I want you to always X" | feedback | `memory/feedback.md` |
| "I prefer X" / "I want X to be Y" / "make sure X is always Y" | user | `memory/preferences.md` |
| "we decided to X because Y" / "the reason we X is Y" | project | `memory/decisions.md` |
| Any named constraint, rule, or requirement stated by the user | project | `memory/decisions.md` |
| Any app-specific design, style, or UX preference | user | `memory/preferences.md` |

**Rule:** Save silently, then proceed. Do not ask permission. Do not announce it unless it helps the user confirm what was captured.

---

## Three Absolute Rules

1. **Never wipe or drop user DB tables.** Use `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ADD COLUMN` only.
   Full rules: `DEVELOPMENT_RULES.md`

2. **Expenses are stored as NEGATIVE amounts. Income is POSITIVE.** Never mix signs in calculations.
   Full rules: `docs/financial-accuracy-rules.md`

3. **Every task ends with a passing build:** `cd frontend && npm run build`, then `build.bat` from repo root.

---

## Critical Terminology

| Term | Meaning |
|---|---|
| **Account** | Top-level bank account or credit card |
| **Category** | Sub-account used to classify transactions (child of Account) |

These terms must be consistent across UI labels, API responses, and code comments.

---

## Key Entry Points

| Area | Path |
|---|---|
| Backend entry | `backend/app/main.py` |
| API routes | `backend/app/routers/` |
| Core business logic | `backend/app/services/data_service.py` |
| Frontend pages | `frontend/src/pages/` |
| API client | `frontend/src/api/client.js` |

---

## Dev Commands

```bash
# Backend dev server
cd backend && python -m uvicorn app.main:app --reload --port 8000

# Frontend dev server (separate terminal)
cd frontend && npm run dev

# Run backend tests
cd backend && pytest

# Syntax check only (fast)
cd backend && python -m py_compile app/main.py app/services/data_service.py

# Build frontend
cd frontend && npm run build

# Full installer build (required before marking any task done)
build.bat
```

---

## Memory System

Session memory lives at `~/.claude/projects/C--Users-mazen-DEV-LocalBookKeeping/memory/`.
Read `MEMORY.md` there at the start of each session. Write new entries when making non-obvious decisions, discovering important context, or when auto-memory triggers fire.

| File | Contains |
|---|---|
| `project-setup.md` | Stack, goals, key constraints, two-DB-filename issue |
| `known-issues.md` | Known bugs and quirks not yet fixed |
| `feedback.md` | Rules and workflow preferences stated by the user |
| `preferences.md` | App-specific design and style preferences |
| `decisions.md` | Architectural and product decisions with rationale |
