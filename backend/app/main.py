r"""
LocalBooks - Main FastAPI Application.
Local-first bookkeeping for small businesses.
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

_PORT_RANGE_START = 8000
_PORT_RANGE_END = 8020
_server_port: int = _PORT_RANGE_START


def _app_url(port: int | None = None) -> str:
    return f"http://127.0.0.1:{port or _server_port}"


def _find_running_instance() -> int | None:
    """Return the port of an already-running LocalBooks instance, or None."""
    import urllib.request
    import json as _json

    for port in range(_PORT_RANGE_START, _PORT_RANGE_END + 1):
        try:
            url = f"http://127.0.0.1:{port}/api/health"
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=0.5) as resp:
                data = _json.loads(resp.read())
                if data.get("app") == "LocalBooks":
                    return port
        except Exception:
            continue
    return None


def _find_free_port() -> int:
    """Return the first available port in the range, or raise RuntimeError."""
    for port in range(_PORT_RANGE_START, _PORT_RANGE_END + 1):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.3):
                pass  # port is in use
        except OSError:
            return port  # connection refused = port is free
    raise RuntimeError(
        f"No free port found in range {_PORT_RANGE_START}-{_PORT_RANGE_END}"
    )

if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

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

if getattr(sys, 'frozen', False):
    INSTALL_DIR = Path(sys.executable).parent
    DATA_DIR = INSTALL_DIR / "company_data"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DB_PATH = DATA_DIR / "ledgerlocal.db"

    bundled_db = Path(sys._MEIPASS) / "company_data" / "ledgerlocal.db"
    if DB_PATH.exists():
        log(f"[DATA SAFE] Using existing database at {DB_PATH} ({DB_PATH.stat().st_size} bytes)")
    elif bundled_db.exists():
        log(f"[FIRST RUN] No existing database found at {DB_PATH}. Copying bundled demo database.")
        shutil.copy2(bundled_db, DB_PATH)
        log(f"[FIRST RUN] Demo database installed at {DB_PATH}")
    else:
        log(f"[WARNING] No database found at {DB_PATH} and no bundled database available.")

    FRONTEND_DIST = Path(sys._MEIPASS) / "frontend" / "dist"
else:
    DATA_DIR = Path(__file__).resolve().parent.parent / "company_data"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DB_PATH = DATA_DIR / "ledgerlocal.db"
    FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

log(f"DB_PATH: {DB_PATH}")
log(f"FRONTEND_DIST: {FRONTEND_DIST}")

try:
    import uvicorn
    from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
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
    from app.services.seed_data import seed_demo_data, seed_default_accounts
    from app.services.update_service import check_for_updates, download_and_install_update
    from app.routers import accounts, transactions, budgets, reports, documents, settings
    from app.routers import reconciliation
    log("App modules OK")
except Exception:
    show_error("LocalBooks - Import Error", traceback.format_exc())
    sys.exit(1)

try:
    conn = connect(str(DB_PATH))
    init_schema(conn)
    company_id = ensure_company(conn, "Demo Company", "USD")
    seed_demo_data(conn, company_id)

    all_companies = conn.execute("SELECT id FROM company ORDER BY id").fetchall()
    for row in all_companies:
        cid = row["id"]
        seed_default_accounts(conn, cid)
    log(f"Ensured default accounts for {len(all_companies)} company(ies)")

    init_state(conn, company_id, DATA_DIR)

    companies = conn.execute("SELECT name FROM company ORDER BY id").fetchall()
    company_names = [r["name"] for r in companies]
    if len(company_names) == 1 and company_names[0] == "Demo Company":
        log("[NOTE] Database contains only the Demo Company. If you expected other companies, "
            "check if the database was recently recreated. Backups may exist in "
            "company_data/backups/ or Documents/LocalBooks/company_data/backups/.")

    log("DB init OK")
except Exception:
    show_error("LocalBooks - Database Error", traceback.format_exc())
    sys.exit(1)

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
app.include_router(reconciliation.router)

@app.get("/api/health")
def health():
    return {"status": "ok", "version": "1.0.0", "app": "LocalBooks"}

_last_heartbeat = time.time()

# ── Background update check (runs once at startup, never blocks requests) ──
_update_result = {"checked": False, "version": None}

def _background_update_check():
    try:
        v = check_for_updates()
        _update_result["version"] = v
    except Exception:
        pass
    _update_result["checked"] = True

threading.Thread(target=_background_update_check, daemon=True).start()

@app.get("/api/heartbeat")
def heartbeat():
    global _last_heartbeat
    _last_heartbeat = time.time()
    return {"ok": True}

@app.get("/api/health/update")
def check_update():
    v = _update_result["version"]
    return {"status": "ok", "update_available": bool(v), "latest_version": v}

@app.post("/api/update/install")
def install_update(background_tasks: BackgroundTasks):
    """
    Downloads LocalBooks_Setup.exe from GitHub Releases and launches it as a
    detached process. The installer kills the running exe, performs selective
    extraction (skipping company_data/), and starts the new version.
    This process then exits after flushing the response.
    """
    try:
        download_and_install_update()
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    def _shutdown():
        time.sleep(1.0)
        log("Shutting down for in-app update — installer is running.")
        os._exit(0)

    background_tasks.add_task(_shutdown)
    return {"ok": True}

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
    webbrowser.open(_app_url())


def _auto_shutdown_monitor():
    global _last_heartbeat
    last_check = time.time()
    while True:
        time.sleep(60)
        now = time.time()
        if now - last_check > 120.0:
            _last_heartbeat = now
            last_check = now
            continue
        if now - _last_heartbeat > 1800.0:
            log("No heartbeat received for 30 minutes. Shutting down LocalBooks background process.")
            os._exit(0)
        last_check = now


if __name__ == "__main__":
    existing_port = _find_running_instance()
    if existing_port is not None:
        log(f"Server already running on port {existing_port} – opening browser.")
        webbrowser.open(_app_url(existing_port))
        sys.exit(0)

    try:
        _server_port = _find_free_port()
    except RuntimeError as e:
        show_error("LocalBooks - Port Error", str(e))
        sys.exit(1)

    log(f"Starting server on :{_server_port} ...")
    if getattr(sys, 'frozen', False):
        threading.Thread(target=open_browser, daemon=True).start()
        threading.Thread(target=_auto_shutdown_monitor, daemon=True).start()
    try:
        uvicorn.run(app, host="127.0.0.1", port=_server_port, log_level="error", access_log=False)
    except Exception:
        show_error("LocalBooks - Server Error", traceback.format_exc())
        sys.exit(1)
