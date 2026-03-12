
import sqlite3
from pathlib import Path

db_path = Path("backend/company_data/ledgerlocal.db")
if not db_path.exists():
    print(f"Error: {db_path} does not exist")
    exit(1)

conn = sqlite3.connect(str(db_path))
conn.row_factory = sqlite3.Row

print("=== Companies ===")
companies = conn.execute("SELECT * FROM company").fetchall()
for c in companies:
    print(dict(c))

print("\n=== Account Count ===")
count = conn.execute("SELECT COUNT(*) as cnt FROM accounts").fetchone()
print(f"Accounts: {count['cnt']}")

print("\n=== Transaction Count ===")
count = conn.execute("SELECT COUNT(*) as cnt FROM transactions").fetchone()
print(f"Transactions: {count['cnt']}")

conn.close()
