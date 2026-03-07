from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import List

try:
    import pdfplumber
except ImportError:  # pragma: no cover
    pdfplumber = None

DATE_PATTERNS = [
    re.compile(r"(?P<date>\d{2}/\d{2}/\d{4})"),
    re.compile(r"(?P<date>\d{4}-\d{2}-\d{2})"),
]
AMOUNT_PATTERN = re.compile(r"(?P<amount>[-]?\$?\d+[\d,]*\.\d{2})")


@dataclass
class ParsedTransaction:
    txn_date: str
    description: str
    amount: float
    vendor_name: str


def parse_pdf(path: Path) -> List[ParsedTransaction]:
    if pdfplumber is None:
        return []

    lines: List[str] = []
    with pdfplumber.open(str(path)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            lines.extend(text.splitlines())

    results: List[ParsedTransaction] = []
    for line in lines:
        date = _extract_date(line)
        amount = _extract_amount(line)
        if not date or amount is None:
            continue
        description = line.strip()
        vendor_name = _guess_vendor(description)
        results.append(
            ParsedTransaction(txn_date=date, description=description, amount=amount, vendor_name=vendor_name)
        )
    return results


def _extract_date(text: str) -> str | None:
    for pattern in DATE_PATTERNS:
        match = pattern.search(text)
        if match:
            raw = match.group("date")
            for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
                try:
                    parsed = datetime.strptime(raw, fmt)
                    return parsed.strftime("%Y-%m-%d")
                except ValueError:
                    continue
    return None


def _extract_amount(text: str) -> float | None:
    match = AMOUNT_PATTERN.search(text)
    if not match:
        return None
    raw = match.group("amount").replace("$", "").replace(",", "")
    try:
        return float(raw)
    except ValueError:
        return None


def _guess_vendor(description: str) -> str:
    tokens = re.split(r"\s+", description)
    return tokens[1] if len(tokens) > 1 else description[:20]
