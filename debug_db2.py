import sqlite3

db_path = "backend/company_data/ledgerlocal.db"
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row

print("--- Recent Documents ---")
docs = conn.execute("SELECT id, filename, status, error_msg, imported_at, processed_at, page_count FROM documents ORDER BY id DESC LIMIT 5").fetchall()
for d in docs:
    for k, v in dict(d).items():
        print(f"{k}: {v}")
    print("---")
