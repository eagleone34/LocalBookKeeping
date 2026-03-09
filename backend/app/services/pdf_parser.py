"""
PDF Statement Parser.

Extracts transaction-level data from bank/credit card PDF statements.
Uses pdfplumber for text extraction, falls back to OCR via pytesseract.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import List, Optional

try:
    import pdfplumber
except ImportError:
    pdfplumber = None

try:
    from PIL import Image
    import pytesseract
except ImportError:
    pytesseract = None


DATE_PATTERNS = [
    re.compile(r"(?P<date>\d{1,2}/\d{1,2}/\d{4})"),
    re.compile(r"(?P<date>\d{4}-\d{2}-\d{2})"),
    re.compile(r"(?P<date>\d{1,2}-\d{1,2}-\d{4})"),
    re.compile(r"(?P<date>[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4})"),
]

AMOUNT_PATTERN = re.compile(r"(?P<amount>[-]?\$?\s?\d{1,3}(?:,\d{3})*\.\d{2})")

SKIP_PATTERNS = [
    re.compile(r"opening balance", re.IGNORECASE),
    re.compile(r"closing balance", re.IGNORECASE),
    re.compile(r"statement period", re.IGNORECASE),
    re.compile(r"page \d+", re.IGNORECASE),
    re.compile(r"account number", re.IGNORECASE),
]


@dataclass
class ParsedTransaction:
    txn_date: str
    description: str
    amount: float
    vendor_name: str
    raw_line: str


def parse_pdf(file_path: str) -> List[ParsedTransaction]:
    """
    Parse a PDF file and extract transaction data.
    Returns a list of parsed transactions.
    """
    path = Path(file_path)
    if not path.exists():
        return []

    lines = _extract_text_lines(path)
    if not lines:
        lines = _ocr_extract(path)

    results: List[ParsedTransaction] = []
    for line in lines:
        if _should_skip(line):
            continue
        parsed = _parse_line(line)
        if parsed:
            results.append(parsed)

    return results


def get_page_count(file_path: str) -> int:
    """Get the number of pages in a PDF."""
    if not pdfplumber:
        return 0
    try:
        with pdfplumber.open(file_path) as pdf:
            return len(pdf.pages)
    except Exception:
        return 0


def _extract_text_lines(path: Path) -> List[str]:
    """Extract text lines from PDF using pdfplumber."""
    if not pdfplumber:
        return []
    lines: List[str] = []
    try:
        with pdfplumber.open(str(path)) as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ""
                lines.extend(text.splitlines())
    except Exception:
        pass
    return [l.strip() for l in lines if l.strip()]


def _ocr_extract(path: Path) -> List[str]:
    """Fallback: use OCR to extract text from PDF pages rendered as images."""
    if not pdfplumber or not pytesseract:
        return []
    lines: List[str] = []
    try:
        with pdfplumber.open(str(path)) as pdf:
            for page in pdf.pages:
                img = page.to_image(resolution=300).original
                text = pytesseract.image_to_string(img)
                lines.extend(text.splitlines())
    except Exception:
        pass
    return [l.strip() for l in lines if l.strip()]


def _should_skip(line: str) -> bool:
    """Check if a line should be skipped (headers, footers, etc.)."""
    for pattern in SKIP_PATTERNS:
        if pattern.search(line):
            return True
    return len(line) < 10


def _parse_line(line: str) -> Optional[ParsedTransaction]:
    """Try to parse a single line into a transaction."""
    date_str = _extract_date(line)
    amount = _extract_amount(line)
    if not date_str or amount is None:
        return None

    # Remove date and amount from description
    desc = line
    desc = re.sub(r"\d{1,2}/\d{1,2}/\d{4}", "", desc)
    desc = re.sub(r"\d{4}-\d{2}-\d{2}", "", desc)
    desc = AMOUNT_PATTERN.sub("", desc)
    desc = re.sub(r"\s+", " ", desc).strip()

    vendor = _guess_vendor(desc)

    return ParsedTransaction(
        txn_date=date_str,
        description=desc[:200],
        amount=amount,
        vendor_name=vendor,
        raw_line=line[:300],
    )


def _extract_date(text: str) -> Optional[str]:
    """Extract and normalize a date from text."""
    for pattern in DATE_PATTERNS:
        match = pattern.search(text)
        if match:
            raw = match.group("date")
            for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m-%d-%Y", "%b %d, %Y", "%b %d %Y"):
                try:
                    parsed = datetime.strptime(raw, fmt)
                    return parsed.strftime("%Y-%m-%d")
                except ValueError:
                    continue
    return None


def _extract_amount(text: str) -> Optional[float]:
    """Extract the monetary amount from text."""
    match = AMOUNT_PATTERN.search(text)
    if not match:
        return None
    raw = match.group("amount").replace("$", "").replace(",", "").replace(" ", "")
    try:
        return float(raw)
    except ValueError:
        return None


def _guess_vendor(description: str) -> str:
    """Guess vendor name from the cleaned description."""
    # Take first 2-3 meaningful words
    words = description.split()
    # Filter out common noise words
    noise = {"pos", "debit", "credit", "card", "purchase", "payment", "ach", "wire", "transfer", "ref", "#", "no."}
    meaningful = [w for w in words if w.lower() not in noise and len(w) > 1]
    if meaningful:
        return " ".join(meaningful[:3])
    return description[:30] if description else "Unknown"
