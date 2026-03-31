import argparse
import os
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

# Add backend to Python path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import connect, init_schema
from app.services.data_service import ensure_company
from app.services.seed_data import seed_demo_data
from app.main_state import init_state

DATA_DIR = Path(__file__).resolve().parent.parent / "company_data"
DB_PATH = DATA_DIR / "ledgerlocal.db"


def _has_user_data(db_path: Path) -> bool:
    """Check if the database contains user data beyond the default Demo Company."""
    try:
        conn = sqlite3.connect(str(db_path))
        companies = [r[0] for r in conn.execute("SELECT name FROM company").fetchall()]
        tx_count = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
        conn.close()

        has_non_demo = any(name != "Demo Company" for name in companies)
        has_many_tx = tx_count > 500

        return has_non_demo or has_many_tx
    except Exception:
        return False


def _backup_db(db_path: Path) -> Path:
    """Create a timestamped backup of the database before wiping."""
    backup_dir = db_path.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = backup_dir / f"ledgerlocal_backup_{timestamp}.db"
    shutil.copy2(db_path, backup_path)
    print(f"  Backup created: {backup_path}")
    return backup_path


def build_golden_copy(force: bool = False):
    print("Building Golden Copy with Demo Data...")

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if DB_PATH.exists():
        if _has_user_data(DB_PATH) and not force:
            print()
            print("ERROR: Database contains user data (non-demo companies or >500 transactions).")
            print(f"  DB path: {DB_PATH}")
            print()
            print("This script DELETES the database and recreates it with demo data only.")
            print("To proceed, run with --force:")
            print(f"  python {Path(__file__).name} --force")
            print()
            print("A backup will be created automatically before deletion.")
            sys.exit(1)

        print(f"  Backing up existing database before deletion...")
        _backup_db(DB_PATH)
        print(f"  Removing existing database at {DB_PATH}")
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
    parser = argparse.ArgumentParser(description="Build a fresh demo database for bundling.")
    parser.add_argument("--force", action="store_true",
                        help="Force rebuild even if user data is detected (backup is always created)")
    args = parser.parse_args()
    build_golden_copy(force=args.force)
