import sys
import os

# Add backend dir to Python path so we can import app
sys.path.append(os.path.abspath("backend"))

from app.services.pdf_parser import parse_statement, _extract_all
from pathlib import Path

pdf_path = r"test_data\Business Checking - CAD Statement-6948 2026-01-02.pdf"

print("--- FULL PARSE RESULT ---")
info = parse_statement(pdf_path)
print(f"Bank: {info.bank_name}")
print(f"Account Last 4: {info.account_last_four}")
print(f"Transactions: {len(info.transactions)}")
for t in info.transactions:
    print(t)

print("\n--- RAW EXTRACTION ---")
all_text, tables, page_texts = _extract_all(Path(pdf_path))
print("ALL TEXT PREVIEW (first 1000 chars):")
print(all_text[:1000])

print("\nFirst few lines of all text:")
for i, line in enumerate(all_text.splitlines()[:50]):
    print(f"{i}: {line}")

print("\nTABLES EXTRACTED:", len(tables))

