"""
LocalBooks - Main FastAPI Application.
Local-first bookkeeping for small businesses.

NOTE: This exe is always run from its installed location (Documents\LocalBooks\).
The installer (LocalBooks_Setup.exe) handles installation and shortcut creation.
"""
from __future__ import annotations

import sys
import os
import shutil
import socket
import threading
import webbrowser
import time
import traceback
from pathlib import Path

APP_URL = "http://127.0.0.1:8000"


def _is_server_running() -> bool:
    """Check if the LocalBooks server is already listening on port 8000."""
    try:
        with socket.create_connection(("127.0.0.1", 8000), timeout=1.0):
            return True
    except OSError:
        return False

# Silence stdout/stderr in noconsole exe so uvicorn doesn't crash
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

# Crash log
LOG_FILE = Path.home() / "Documents" / "LocalBooks" / "localbooks.log"


def log(msg: str):
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} - {msg}\n")
    except Exception:
        pass


def show_error(title: str, msg: str):
    log(f"FATAL: {msg}")
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, msg[:2000], title, 0x10)
    except Exception:
        pass


log("=== LocalBooks starting ===")
log(f"exe: {sys.executable}")

# ── Data directories ──
if getattr(sys, 'frozen', False):
    # Running as a packaged exe from Documents\LocalBooks\
    INSTALL_DIR = Path(sys.executable).parent
    DATA_DIR = INSTALL_DIR / "company_data"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DB_PATH = DATA_DIR / "localbooks.db"

    # On first run, copy the bundled golden-copy DB
    bundled_db = Path(sys._MEIPASS) / "company_data" / "ledgerlocal.db"
    if not DB_PATH.exists() and bundled_db.exists():
        shutil.copy2(bundled_db, DB_PATH)
        log("Copied bundled demo DB to data dir.")

    FRONTEND_DIST = Path(sys._MEIPASS) / "frontend" / "dist"
else:
    # Dev mode
    DATA_DIR = Path(__file__).resolve().parent.parent / "company_data"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DB_PATH = DATA_DIR / "ledgerlocal.db"
    FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

log(f"DB_PATH: {DB_PATH}")
log(f"FRONTEND_DIST: {FRONTEND_DIST}")

# ── Imports ──
try:
    import uvicorn
    from fastapi import FastAPI, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles
    log("FastAPI OK")
except Exception:
    show_error("LocalBooks - Import Error", traceback.format_exc())
    sys.exit(1)

try:
    from app.database import connect, init_schema
    from app.main_state import init_state, set_company_id
    from app.services.data_service import ensure_company
    from app.services.seed_data import seed_demo_data
    from app.services.update_service import check_for_updates
    from app.routers import accounts, transactions, budgets, reports, documents, settings
    log("App modules OK")
except Exception:
    show_error("LocalBooks - Import Error", traceback.format_exc())
    sys.exit(1)

# ── DB ──
try:
    conn = connect(str(DB_PATH))
    init_schema(conn)
    company_id = ensure_company(conn, "My Company", "USD")
    seed_demo_data(conn, company_id)
    init_state(conn, company_id, DATA_DIR)
    log("DB init OK")
except Exception:
    show_error("LocalBooks - Database Error", traceback.format_exc())
    sys.exit(1)

# ── App ──
app = FastAPI(title="LocalBooks", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def company_context_middleware(request: Request, call_next):
    cid = request.headers.get("X-Company-Id")
    if cid and cid.isdigit():
        set_company_id(int(cid))
    return await call_next(request)

app.include_router(accounts.router)
app.include_router(transactions.router)
app.include_router(budgets.router)
app.include_router(reports.router)
app.include_router(documents.router)
app.include_router(settings.router)

@app.get("/api/health")
def health():
    return {"status": "ok", "version": "1.0.0"}

@app.get("/api/health/update")
def check_update():
    v = check_for_updates()
    return {"status": "ok", "update_available": bool(v), "latest_version": v}

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(request: Request, full_path: str):
        p = FRONTEND_DIST / full_path
        if full_path and p.is_file():
            return FileResponse(p)
        return FileResponse(FRONTEND_DIST / "index.html")
else:
    log(f"WARNING: FRONTEND_DIST not found: {FRONTEND_DIST}")


def open_browser():
    time.sleep(2.0)
    webbrowser.open("http://127.0.0.1:8000")


if __name__ == "__main__":
    # ── Single-instance guard ──
    # If the server is already running (e.g. user clicked the exe again after
    # closing the browser tab), just open the browser and exit cleanly.
    if _is_server_running():
        log("Server already running – opening browser.")
        webbrowser.open(APP_URL)
        sys.exit(0)

    log("Starting server on :8000 ...")
    if getattr(sys, 'frozen', False):
        threading.Thread(target=open_browser, daemon=True).start()
    try:
        uvicorn.run(app, host="127.0.0.1", port=8000, log_level="error", access_log=False)
    except Exception:
        show_error("LocalBooks - Server Error", traceback.format_exc())
        sys.exit(1)
