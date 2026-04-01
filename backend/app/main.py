r"""
LocalBooks - Main FastAPI Application.
Local-first bookkeeping for small businesses.
"""
from __future__ import annotations

import sys
import os
import shutil
import socket
import subprocess
import threading
import webbrowser
import time
import traceback
from pathlib import Path

APP_URL = "http://127.0.0.1:8000"


def _is_server_running() -> bool:
    try:
        with socket.create_connection(("127.0.0.1", 8000), timeout=1.0):
            return True
    except OSError:
        return False


def _kill_port_8000() -> None:
    """Kill any process listening on port 8000 (Windows only).

    Uses netstat to find the PID, then taskkill to terminate it.
    Called by the installed app to reclaim the port from stale dev servers.
    """
    try:
        result = subprocess.run(
            ["netstat", "-ano"],
            capture_output=True, text=True, timeout=5,
        )
        pids_killed = set()
        for line in result.stdout.splitlines():
            if "127.0.0.1:8000" in line and "LISTENING" in line:
                parts = line.split()
                pid = parts[-1]
                if pid and pid.isdigit() and pid not in pids_killed:
                    log(f"[PORT CONFLICT] Killing PID {pid} holding port 8000")
                    subprocess.run(
                        ["taskkill", "/F", "/PID", pid],
                        capture_output=True, timeout=5,
                    )
                    pids_killed.add(pid)
        if pids_killed:
            log(f"[PORT CONFLICT] Killed {len(pids_killed)} process(es) on port 8000")
        else:
            log("[PORT CONFLICT] No LISTENING process found on port 8000")
    except Exception as e:
        log(f"[PORT CONFLICT] Failed to kill port 8000 processes: {e}")

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

    # Dev-mode auto-recovery: if dev DB is missing or demo-only, copy from installed app
    INSTALLED_DB = Path.home() / "Documents" / "LocalBooks" / "company_data" / "ledgerlocal.db"
    if INSTALLED_DB.exists():
        dev_is_demo_only = False
        if not DB_PATH.exists():
            dev_is_demo_only = True
        else:
            try:
                import sqlite3 as _sq
                _c = _sq.connect(str(DB_PATH))
                _names = [r[0] for r in _c.execute("SELECT name FROM company").fetchall()]
                _tx = _c.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
                _c.close()
                dev_is_demo_only = all(n == "Demo Company" for n in _names) and _tx < 500
            except Exception:
                dev_is_demo_only = False

        if dev_is_demo_only:
            try:
                # Backup current dev DB before overwriting
                if DB_PATH.exists():
                    backup_dir = DATA_DIR / "backups"
                    backup_dir.mkdir(parents=True, exist_ok=True)
                    import time as _time
                    backup_name = f"ledgerlocal_backup_{_time.strftime('%Y%m%d_%H%M%S')}.db"
                    shutil.copy2(DB_PATH, backup_dir / backup_name)
                    log(f"[DATA RECOVERY] Backed up demo-only dev DB to backups/{backup_name}")

                shutil.copy2(INSTALLED_DB, DB_PATH)
                import sqlite3 as _sq
                _c = _sq.connect(str(DB_PATH))
                _co = _c.execute("SELECT COUNT(*) FROM company").fetchone()[0]
                _tx = _c.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
                _c.close()
                log(f"[DATA RECOVERY] Copied user database from installed app "
                    f"({_co} companies, {_tx} transactions)")
            except Exception as e:
                log(f"[DATA RECOVERY] Failed to copy installed app DB: {e}")

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
    return {"status": "ok", "version": "1.0.0"}

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
    webbrowser.open("http://127.0.0.1:8000")


def _auto_shutdown_monitor():
    last_check = time.time()
    while True:
        time.sleep(5)
        now = time.time()
        if now - last_check > 10.0:
            last_check = now
            continue
        if now - _last_heartbeat > 30.0:
            log("No heartbeat received for 30 seconds. Shutting down LocalBooks background process.")
            os._exit(0)
        last_check = now


if __name__ == "__main__":
    if _is_server_running():
        if getattr(sys, 'frozen', False):
            # Installed app always takes over — kill stale server and reclaim port
            log("[PORT CONFLICT] Port 8000 in use. Killing stale server to take over...")
            _kill_port_8000()
            time.sleep(2)  # Wait for port to be released
            if _is_server_running():
                log("[PORT CONFLICT] Could not free port 8000. Opening browser to existing server.")
                webbrowser.open(APP_URL)
                sys.exit(0)
            log("[PORT CONFLICT] Port 8000 freed. Starting installed app server.")
        else:
            # Dev mode — just open browser to whatever's already running
            log("Server already running – opening browser.")
            webbrowser.open(APP_URL)
            sys.exit(0)

    log("Starting server on :8000 ...")
    if getattr(sys, 'frozen', False):
        threading.Thread(target=open_browser, daemon=True).start()
    # Auto-shutdown monitor runs in ALL modes to prevent stale server processes.
    # When the browser closes and heartbeats stop, the server shuts down after 30s.
    threading.Thread(target=_auto_shutdown_monitor, daemon=True).start()
    try:
        uvicorn.run(app, host="127.0.0.1", port=8000, log_level="error", access_log=False)
    except Exception:
        show_error("LocalBooks - Server Error", traceback.format_exc())
        sys.exit(1)
