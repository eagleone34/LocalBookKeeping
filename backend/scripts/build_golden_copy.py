import os
import sys
from pathlib import Path

# Add backend to Python path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import connect, init_schema
from app.services.data_service import ensure_company
from app.services.seed_data import seed_demo_data
from app.main_state import init_state

def build_golden_copy():
    print("Building Golden Copy with Demo Data...")

    # Data directory
    DATA_DIR = Path(__file__).resolve().parent.parent / "company_data"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DB_PATH = DATA_DIR / "ledgerlocal.db"

    # Wipe existing database
    if DB_PATH.exists():
        print(f"Removing existing database at {DB_PATH}")
        os.remove(DB_PATH)

    # Initialize new database
    print("Initializing schema...")
    conn = connect(str(DB_PATH))
    init_schema(conn)

    # Ensure company exists
    print("Creating company...")
    company_id = ensure_company(conn, "Demo Company", "USD")

    # Seed demo data
    print("Seeding Demo Accounts & Transactions data...")
    seed_demo_data(conn, company_id)

    # Init state
    init_state(conn, company_id, DATA_DIR)

    conn.close()
    print("Golden Copy database built successfully!")

if __name__ == "__main__":
    build_golden_copy()
