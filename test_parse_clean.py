import sys
import os
from pathlib import Path

sys.path.append(os.path.abspath("backend"))
from app.services.pdf_parser import parse_statement, _extract_all

pdf_path = r"test_data\Business Checking - CAD Statement-6948 2026-01-02.pdf"

print("--- FULL PARSE RESULT ---")
info = parse_statement(pdf_path)
print(f"Bank: {info.bank_name}")
print(f"Account Last 4: {info.account_last_four}")
print(f"Transactions: {len(info.transactions)}")

print("\n--- RAW TEXT FRAGMENT ---")
all_text, _, _ = _extract_all(Path(pdf_path))
for i, line in enumerate(all_text.splitlines()[:50]):
    print(f"{i}: {line}")
