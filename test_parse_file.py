import sys
import os
from pathlib import Path

sys.path.append(os.path.abspath("backend"))
from app.services.pdf_parser import parse_statement, _extract_all

pdf_path = r"test_data\Business Checking - CAD Statement-6948 2026-01-02.pdf"

info = parse_statement(pdf_path)

all_text, _, _ = _extract_all(Path(pdf_path))

with open("output.txt", "w", encoding="utf-8") as f:
    f.write("--- FULL PARSE RESULT ---\n")
    f.write(f"Bank: {info.bank_name}\n")
    f.write(f"Account Last 4: {info.account_last_four}\n")
    f.write(f"Transactions: {len(info.transactions)}\n")
    for i, t in enumerate(info.transactions):
        f.write(f"Txn {i+1}: Date={t.txn_date}, Amount={t.amount}, Vendor={t.vendor_name}, Desc={t.description}\n")

    f.write("\n--- RAW TEXT FRAGMENT ---\n")
    for i, line in enumerate(all_text.splitlines()):
        f.write(f"{i:03d}: {line}\n")
