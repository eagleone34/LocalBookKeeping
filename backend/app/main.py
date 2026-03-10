"""
LedgerLocal - Main FastAPI Application.
Local-first bookkeeping for small businesses.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.database import connect, init_schema
from app.main_state import init_state, set_company_id
from app.services.data_service import ensure_company
from app.services.seed_data import seed_demo_data

from app.routers import accounts, transactions, budgets, reports, documents, settings

# ── Data directory ──
DATA_DIR = Path(__file__).resolve().parent.parent / "company_data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# ── Database init ──
DB_PATH = DATA_DIR / "ledgerlocal.db"
conn = connect(DB_PATH)
init_schema(conn)
company_id = ensure_company(conn, "My Company", "USD")
seed_demo_data(conn, company_id)
init_state(conn, company_id, DATA_DIR)

# ── FastAPI app ──
app = FastAPI(
    title="LedgerLocal",
    description="Secure, local-first bookkeeping application",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def company_context_middleware(request: Request, call_next):
    company_id_str = request.headers.get("X-Company-Id")
    if company_id_str and company_id_str.isdigit():
        set_company_id(int(company_id_str))
    
    response = await call_next(request)
    return response

# ── Register routers ──
app.include_router(accounts.router)
app.include_router(transactions.router)
app.include_router(budgets.router)
app.include_router(reports.router)
app.include_router(documents.router)
app.include_router(settings.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "1.0.0"}


# ── Serve React frontend (production) ──
FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    # Serve static assets (JS, CSS, images)
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(request: Request, full_path: str):
        """Serve the React SPA for all non-API routes."""
        # Try to serve the exact file first
        file_path = FRONTEND_DIST / full_path
        if full_path and file_path.is_file():
            return FileResponse(file_path)
        # Otherwise serve index.html (SPA routing)
        return FileResponse(FRONTEND_DIST / "index.html")
