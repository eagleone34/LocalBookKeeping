import sqlite3
import sys

db_path = "backend/company_data/ledgerlocal.db"
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row

print("--- Recent Documents ---")
docs = conn.execute("SELECT id, filename, status, error_msg, page_count FROM documents ORDER BY id DESC LIMIT 5").fetchall()
for d in docs:
    print(dict(d))

print("--- Recent Doc Transactions ---")
txns = conn.execute("SELECT id, document_id, txn_date, amount, vendor_name FROM document_transactions ORDER BY id DESC LIMIT 5").fetchall()
for t in txns:
    print(dict(t))

conn.close()
