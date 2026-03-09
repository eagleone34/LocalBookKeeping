"""
PDF Statement Parser - Production-grade bank statement extraction.

Extracts:
  - Bank name and account number (learns and remembers)
  - All transactions with dates, descriptions, amounts
  - Handles table-format statements and line-by-line formats
  - Uses pdfplumber for text + table extraction, falls back to OCR
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple

try:
    import pdfplumber
except ImportError:
    pdfplumber = None

try:
    from PIL import Image
    import pytesseract
except ImportError:
    pytesseract = None


# -------------------------------------------------------
#  DATA CLASSES
# -------------------------------------------------------

@dataclass
class ParsedTransaction:
    txn_date: str
    description: str
    amount: float
    vendor_name: str
    raw_line: str
    balance: Optional[float] = None


@dataclass
class StatementInfo:
    bank_name: str = ""
    account_last_four: str = ""
    account_full_number: str = ""
    statement_period: str = ""
    transactions: List[ParsedTransaction] = field(default_factory=list)


# -------------------------------------------------------
#  BANK DETECTION PATTERNS
# -------------------------------------------------------

BANK_PATTERNS = [
    (re.compile(r"\bchase\b", re.I), "Chase"),
    (re.compile(r"jpmorgan\s*chase", re.I), "Chase"),
    (re.compile(r"bank\s*of\s*america|bofa", re.I), "Bank of America"),
    (re.compile(r"wells?\s*fargo", re.I), "Wells Fargo"),
    (re.compile(r"citi\s*bank|citibank|\bciti\b", re.I), "Citibank"),
    (re.compile(r"capital\s*one", re.I), "Capital One"),
    (re.compile(r"u\.?s\.?\s*bank", re.I), "US Bank"),
    (re.compile(r"pnc\s*bank|\bpnc\b", re.I), "PNC Bank"),
    (re.compile(r"td\s*bank", re.I), "TD Bank"),
    (re.compile(r"fifth\s*third", re.I), "Fifth Third Bank"),
    (re.compile(r"huntington", re.I), "Huntington Bank"),
    (re.compile(r"key\s*bank", re.I), "KeyBank"),
    (re.compile(r"regions\s*(bank|financial)?", re.I), "Regions Bank"),
    (re.compile(r"truist", re.I), "Truist"),
    (re.compile(r"ally\s*(bank|financial)?", re.I), "Ally Bank"),
    (re.compile(r"\bdiscover\b", re.I), "Discover"),
    (re.compile(r"american\s*express|\bamex\b", re.I), "American Express"),
    (re.compile(r"\bschwab\b", re.I), "Charles Schwab"),
    (re.compile(r"\bfidelity\b", re.I), "Fidelity"),
    (re.compile(r"\bmercury\b", re.I), "Mercury"),
    (re.compile(r"\bnovo\b", re.I), "Novo"),
    (re.compile(r"blue\s*vine|bluevine", re.I), "Bluevine"),
    (re.compile(r"\brelay\b", re.I), "Relay"),
    (re.compile(r"\bbrex\b", re.I), "Brex"),
    (re.compile(r"\bramp\b", re.I), "Ramp"),
    (re.compile(r"\bdivvy\b", re.I), "Divvy"),
    (re.compile(r"first\s*republic", re.I), "First Republic"),
    (re.compile(r"silicon\s*valley\s*bank|\bsvb\b", re.I), "Silicon Valley Bank"),
    (re.compile(r"citizens\s*bank", re.I), "Citizens Bank"),
    (re.compile(r"m&t\s*bank", re.I), "M&T Bank"),
    (re.compile(r"bmo\s*(harris)?", re.I), "BMO"),
    (re.compile(r"usaa", re.I), "USAA"),
    (re.compile(r"navy\s*federal", re.I), "Navy Federal"),
]

# Account number patterns - look for last 4 digits
ACCOUNT_NUM_PATTERNS = [
    re.compile(r"account\s*(?:#|number|no\.?|num)?[:\s]*[*xX.\-]*(\d{4})\b", re.I),
    re.compile(r"acct\.?[:\s#]*[*xX.\-]*(\d{4})\b", re.I),
    re.compile(r"(?:ending\s+in|last\s+4|last\s+four)[:\s]*(\d{4})", re.I),
    re.compile(r"[*xX]{3,}\s*(\d{4})", re.I),
    re.compile(r"(?:card|member)\s*(?:number|#|no\.?)?[:\s]*(?:\d[\d\s*-]+)?(\d{4})\s*$", re.I | re.M),
    re.compile(r"x{2,}\d*(\d{4})", re.I),
    re.compile(r"\.\.\.\s*(\d{4})", re.I),
]

FULL_ACCOUNT_PATTERNS = [
    re.compile(r"account\s*(?:#|number|no\.?)?[:\s]*(\d{6,17})", re.I),
    re.compile(r"acct\.?[:\s#]*(\d{6,17})", re.I),
]

# Date patterns (broadened for all US/international formats)
DATE_PATTERNS = [
    re.compile(r"\b(\d{1,2}/\d{1,2}/\d{4})\b"),
    re.compile(r"\b(\d{1,2}/\d{1,2}/\d{2})\b"),
    re.compile(r"\b(\d{4}-\d{2}-\d{2})\b"),
    re.compile(r"\b(\d{1,2}-\d{1,2}-\d{4})\b"),
    re.compile(r"\b(\d{1,2}-\d{1,2}-\d{2})\b"),
    re.compile(r"\b([A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4})\b"),
    re.compile(r"\b(\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4})\b"),
    re.compile(r"\b([A-Z][a-z]{2}\.\?\s+\d{1,2},?\s+\d{4})\b"),
]

# Amount patterns
AMOUNT_PATTERNS = [
    re.compile(r"[-]?\$\s?\d{1,3}(?:,\d{3})*\.\d{2}"),
    re.compile(r"\(\$?\s?\d{1,3}(?:,\d{3})*\.\d{2}\)"),  # parentheses = negative
    re.compile(r"[-]?\d{1,3}(?:,\d{3})*\.\d{2}"),
]

# Lines/sections to skip
SKIP_PATTERNS = [
    re.compile(r"opening balance", re.I),
    re.compile(r"closing balance", re.I),
    re.compile(r"beginning balance", re.I),
    re.compile(r"ending balance", re.I),
    re.compile(r"statement period", re.I),
    re.compile(r"page \d+\s*(of\s*\d+)?", re.I),
    re.compile(r"^\s*date\s+(description|details)", re.I),
    re.compile(r"^\s*trans\.?\s*date", re.I),
    re.compile(r"^\s*post\.?\s*date", re.I),
    re.compile(r"continued on", re.I),
    re.compile(r"previous statement", re.I),
    re.compile(r"new balance", re.I),
    re.compile(r"minimum payment", re.I),
    re.compile(r"payment due", re.I),
    re.compile(r"total\s+(charges|credits|debits|deposits|fees|interest|withdrawals|payments)", re.I),
    re.compile(r"^interest\s+charged\s*$", re.I),
    re.compile(r"annual\s+percentage", re.I),
    re.compile(r"customer\s+service", re.I),
    re.compile(r"(subtotal|balance\s*forward)", re.I),
    re.compile(r"^\s*$"),
]


# -------------------------------------------------------
#  MAIN ENTRY POINTS
# -------------------------------------------------------

def parse_statement(file_path: str) -> StatementInfo:
    """
    Parse a bank/credit card PDF and extract everything.
    Returns a StatementInfo with bank details and transactions.
    """
    path = Path(file_path)
    if not path.exists():
        return StatementInfo()

    all_text, tables, page_texts = _extract_all(path)

    info = StatementInfo()
    info.bank_name = _detect_bank(all_text)
    info.account_last_four = _detect_account_last_four(all_text)
    info.account_full_number = _detect_full_account(all_text)
    info.statement_period = _detect_statement_period(all_text)

    # Try table extraction first (most accurate for bank statements)
    txns = _parse_tables(tables)

    # If tables didn't yield much, parse line by line
    if len(txns) < 2:
        txns = _parse_lines(all_text.splitlines())

    # De-duplicate within the same statement (same date+amount+desc)
    txns = _dedup_extracted(txns)

    info.transactions = txns
    return info


def parse_pdf(file_path: str) -> List[ParsedTransaction]:
    """Legacy interface - returns just the transactions."""
    info = parse_statement(file_path)
    return info.transactions


def get_page_count(file_path: str) -> int:
    if not pdfplumber:
        return 0
    try:
        with pdfplumber.open(file_path) as pdf:
            return len(pdf.pages)
    except Exception:
        return 0


# -------------------------------------------------------
#  TEXT EXTRACTION
# -------------------------------------------------------

def _extract_all(path: Path) -> Tuple[str, list, List[str]]:
    """Extract full text, tables, and per-page text from PDF."""
    if not pdfplumber:
        return "", [], []

    all_lines = []
    tables = []
    page_texts = []

    try:
        with pdfplumber.open(str(path)) as pdf:
            for page in pdf.pages:
                # Extract text
                text = page.extract_text() or ""
                all_lines.append(text)
                page_texts.append(text)

                # Extract tables with custom settings for better detection
                try:
                    # Try with explicit table settings
                    ts = {
                        "vertical_strategy": "lines",
                        "horizontal_strategy": "lines",
                        "snap_tolerance": 5,
                    }
                    page_tables = page.extract_tables(table_settings=ts) or []
                    if not page_tables:
                        # Fallback to default table detection
                        page_tables = page.extract_tables() or []

                    for tbl in page_tables:
                        if tbl and len(tbl) > 1:
                            tables.append(tbl)
                except Exception:
                    # Last resort: try default
                    try:
                        page_tables = page.extract_tables() or []
                        for tbl in page_tables:
                            if tbl and len(tbl) > 1:
                                tables.append(tbl)
                    except Exception:
                        pass
    except Exception:
        # Fall back to OCR
        ocr_text = _ocr_extract(path)
        all_lines = [ocr_text]
        page_texts = [ocr_text]

    return "\n".join(all_lines), tables, page_texts


def _ocr_extract(path: Path) -> str:
    """Fallback OCR extraction."""
    if not pdfplumber or not pytesseract:
        return ""
    lines = []
    try:
        with pdfplumber.open(str(path)) as pdf:
            for page in pdf.pages:
                img = page.to_image(resolution=300).original
                text = pytesseract.image_to_string(img)
                lines.append(text)
    except Exception:
        pass
    return "\n".join(lines)


# -------------------------------------------------------
#  BANK / ACCOUNT DETECTION
# -------------------------------------------------------

def _detect_bank(text: str) -> str:
    """Detect bank name from statement text."""
    # Check first 3000 chars (header area)
    header = text[:3000]
    for pattern, name in BANK_PATTERNS:
        if pattern.search(header):
            return name
    # Check full doc
    for pattern, name in BANK_PATTERNS:
        if pattern.search(text):
            return name
    return ""


def _detect_account_last_four(text: str) -> str:
    """Detect last 4 digits of account number."""
    header = text[:4000]
    for pattern in ACCOUNT_NUM_PATTERNS:
        m = pattern.search(header)
        if m:
            return m.group(1)
    # Try full text
    for pattern in ACCOUNT_NUM_PATTERNS:
        m = pattern.search(text)
        if m:
            return m.group(1)
    return ""


def _detect_full_account(text: str) -> str:
    """Try to find full account number."""
    header = text[:4000]
    for pattern in FULL_ACCOUNT_PATTERNS:
        m = pattern.search(header)
        if m:
            return m.group(1)
    return ""


def _detect_statement_period(text: str) -> str:
    """Try to detect statement period from text."""
    header = text[:3000]
    period_patterns = [
        re.compile(r"statement\s+period[:\s]*(.+?)(?:\n|$)", re.I),
        re.compile(r"(?:for\s+)?period[:\s]+(\w+\s+\d{1,2},?\s+\d{4}\s*(?:to|-|through)\s*\w+\s+\d{1,2},?\s+\d{4})", re.I),
        re.compile(r"(\w+\s+\d{1,2},?\s+\d{4})\s*(?:to|-|through)\s*(\w+\s+\d{1,2},?\s+\d{4})", re.I),
    ]
    for pattern in period_patterns:
        m = pattern.search(header)
        if m:
            return m.group(0).strip()[:100]
    return ""


# -------------------------------------------------------
#  TABLE PARSING (most accurate for bank statements)
# -------------------------------------------------------

def _parse_tables(tables: list) -> List[ParsedTransaction]:
    """Parse structured tables extracted by pdfplumber."""
    results = []
    for table in tables:
        if not table or len(table) < 2:
            continue

        # Find the header row to identify columns
        header = table[0]
        if not header:
            continue

        col_map = _identify_columns(header)
        if not col_map.get("date") and not col_map.get("amount") and not col_map.get("debit"):
            # Try using row 1 as header (some tables have merged header cells)
            if len(table) > 2:
                col_map = _identify_columns(table[1])
                if col_map.get("date") or col_map.get("amount"):
                    for row in table[2:]:
                        if not row:
                            continue
                        txn = _parse_table_row(row, col_map)
                        if txn:
                            results.append(txn)
                    continue

            # No structured header found, try to parse generically
            for row in table[1:]:
                txn = _parse_generic_row(row)
                if txn:
                    results.append(txn)
            continue

        for row in table[1:]:
            if not row:
                continue
            txn = _parse_table_row(row, col_map)
            if txn:
                results.append(txn)

    return results


def _identify_columns(header: list) -> dict:
    """Map header labels to column indices."""
    col_map = {}
    for i, cell in enumerate(header):
        if not cell:
            continue
        cell_lower = str(cell).strip().lower()
        if any(w in cell_lower for w in ["date", "trans", "post"]):
            if "date" not in col_map:
                col_map["date"] = i
        elif any(w in cell_lower for w in ["description", "details", "memo", "payee", "narrative", "reference"]):
            col_map["description"] = i
        elif any(w in cell_lower for w in ["debit", "withdrawal", "charge", "payment", "money out"]):
            col_map["debit"] = i
        elif any(w in cell_lower for w in ["credit", "deposit", "money in"]):
            col_map["credit"] = i
        elif "amount" in cell_lower:
            col_map["amount"] = i
        elif "balance" in cell_lower:
            col_map["balance"] = i
    return col_map


def _parse_table_row(row: list, col_map: dict) -> Optional[ParsedTransaction]:
    """Parse a single table row into a transaction using the column map."""
    try:
        # Get date
        date_str = None
        if "date" in col_map and col_map["date"] < len(row):
            raw = str(row[col_map["date"]] or "").strip()
            date_str = _normalize_date(raw)

        if not date_str:
            # Try to find a date anywhere in the row
            for cell in row:
                if cell:
                    d = _normalize_date(str(cell).strip())
                    if d:
                        date_str = d
                        break

        if not date_str:
            return None

        # Get description
        desc = ""
        if "description" in col_map and col_map["description"] < len(row):
            desc = str(row[col_map["description"]] or "").strip()
        else:
            # Use the largest text cell as description
            best = ""
            for i, cell in enumerate(row):
                s = str(cell or "").strip()
                if len(s) > len(best) and not _looks_like_amount(s) and not _normalize_date(s):
                    best = s
            desc = best

        if not desc or len(desc) < 2:
            return None

        # Get amount
        amount = None
        if "debit" in col_map and col_map["debit"] < len(row):
            debit_val = _parse_amount(str(row[col_map["debit"]] or ""))
            if debit_val is not None and debit_val != 0:
                amount = -abs(debit_val)

        if amount is None and "credit" in col_map and col_map["credit"] < len(row):
            credit_val = _parse_amount(str(row[col_map["credit"]] or ""))
            if credit_val is not None and credit_val != 0:
                amount = abs(credit_val)

        if amount is None and "amount" in col_map and col_map["amount"] < len(row):
            amount = _parse_amount(str(row[col_map["amount"]] or ""))

        if amount is None:
            # Try to find an amount in any cell (from right to left, skip balance)
            bal_idx = col_map.get("balance")
            for i in range(len(row) - 1, -1, -1):
                if i == bal_idx:
                    continue
                if row[i]:
                    a = _parse_amount(str(row[i]))
                    if a is not None:
                        amount = a
                        break

        if amount is None:
            return None

        # Skip header-like or summary rows
        if _should_skip(desc):
            return None

        vendor = _guess_vendor(desc)

        # Get balance if available
        balance = None
        if "balance" in col_map and col_map["balance"] < len(row):
            balance = _parse_amount(str(row[col_map["balance"]] or ""))

        return ParsedTransaction(
            txn_date=date_str,
            description=desc[:200],
            amount=round(amount, 2),
            vendor_name=vendor,
            raw_line=" | ".join(str(c or "") for c in row)[:300],
            balance=balance,
        )
    except Exception:
        return None


def _parse_generic_row(row: list) -> Optional[ParsedTransaction]:
    """Try to parse a row without a known column map."""
    if not row or len(row) < 3:
        return None
    try:
        date_str = None
        desc = ""
        amount = None

        for cell in row:
            s = str(cell or "").strip()
            if not s:
                continue
            if not date_str:
                d = _normalize_date(s)
                if d:
                    date_str = d
                    continue
            if _looks_like_amount(s):
                a = _parse_amount(s)
                if a is not None:
                    amount = a
            elif len(s) > len(desc):
                desc = s

        if not date_str or amount is None or not desc:
            return None
        if _should_skip(desc):
            return None

        vendor = _guess_vendor(desc)
        return ParsedTransaction(
            txn_date=date_str,
            description=desc[:200],
            amount=round(amount, 2),
            vendor_name=vendor,
            raw_line=" | ".join(str(c or "") for c in row)[:300],
        )
    except Exception:
        return None


# -------------------------------------------------------
#  LINE-BY-LINE PARSING (fallback)
# -------------------------------------------------------

def _parse_lines(lines: List[str]) -> List[ParsedTransaction]:
    """Parse transactions from raw text lines."""
    results = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line or len(line) < 8:
            i += 1
            continue

        if _should_skip(line):
            i += 1
            continue

        # Try to parse this line (and maybe the next line for multi-line descriptions)
        date_str = _extract_date_from_line(line)
        if not date_str:
            i += 1
            continue

        # Collect the full description (may span multiple lines)
        full_text = line
        lookahead = 1
        while i + lookahead < len(lines) and lookahead <= 3:
            next_line = lines[i + lookahead].strip()
            if not next_line or _extract_date_from_line(next_line):
                break
            if _should_skip(next_line):
                break
            full_text += " " + next_line
            lookahead += 1

        amount = _extract_amount_from_text(full_text)
        if amount is None:
            i += 1
            continue

        # Clean description (remove date and amounts)
        desc = full_text
        for p in DATE_PATTERNS:
            desc = p.sub("", desc)
        for p in AMOUNT_PATTERNS:
            desc = p.sub("", desc)
        desc = re.sub(r"\s+", " ", desc).strip()

        if len(desc) < 2:
            i += lookahead
            continue

        vendor = _guess_vendor(desc)

        results.append(ParsedTransaction(
            txn_date=date_str,
            description=desc[:200],
            amount=round(amount, 2),
            vendor_name=vendor,
            raw_line=full_text[:300],
        ))
        i += lookahead

    return results


# -------------------------------------------------------
#  DE-DUPLICATION WITHIN ONE STATEMENT
# -------------------------------------------------------

def _dedup_extracted(txns: List[ParsedTransaction]) -> List[ParsedTransaction]:
    """Remove exact duplicates extracted from the same statement."""
    seen = set()
    unique = []
    for t in txns:
        key = (t.txn_date, t.amount, t.description[:50])
        if key not in seen:
            seen.add(key)
            unique.append(t)
    return unique


# -------------------------------------------------------
#  HELPERS
# -------------------------------------------------------

def _normalize_date(text: str) -> Optional[str]:
    """Try to parse a date string and return YYYY-MM-DD."""
    if not text:
        return None
    text = text.strip()
    # Quick reject: too short or doesn't contain a digit
    if len(text) < 5 or not any(c.isdigit() for c in text):
        return None
    formats = [
        "%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d", "%m-%d-%Y", "%m-%d-%y",
        "%b %d, %Y", "%b %d %Y", "%d %b %Y",
        "%B %d, %Y", "%B %d %Y",
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(text, fmt)
            if dt.year < 100:
                dt = dt.replace(year=dt.year + 2000)
            # Sanity check: year should be recent
            if 2000 <= dt.year <= 2035:
                return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    # Try to extract a date from the text
    for pattern in DATE_PATTERNS:
        m = pattern.search(text)
        if m and m.group(1) != text:
            return _normalize_date(m.group(1))
    return None


def _extract_date_from_line(line: str) -> Optional[str]:
    """Extract and normalize a date from a text line."""
    for pattern in DATE_PATTERNS:
        m = pattern.search(line)
        if m:
            return _normalize_date(m.group(1))
    return None


def _parse_amount(text: str) -> Optional[float]:
    """Parse a dollar amount from text."""
    if not text:
        return None
    text = text.strip()
    if not text:
        return None

    # Handle parentheses as negative
    paren = re.search(r"\(([^)]+)\)", text)
    if paren:
        inner = paren.group(1).replace("$", "").replace(",", "").replace(" ", "")
        try:
            return -abs(float(inner))
        except ValueError:
            pass

    text = text.replace("$", "").replace(",", "").replace(" ", "")
    try:
        val = float(text)
        return val
    except ValueError:
        return None


def _extract_amount_from_text(text: str) -> Optional[float]:
    """Find the best dollar amount in text (usually the transaction amount).
    
    Bank statements typically show: Date Description Amount Balance
    So when there are 2 amounts, we want the first one (transaction amount),
    not the second (running balance, which is usually larger).
    """
    amounts = []
    for pattern in AMOUNT_PATTERNS:
        for m in pattern.finditer(text):
            val = _parse_amount(m.group(0))
            if val is not None:
                amounts.append((val, m.start()))

    if not amounts:
        return None

    # De-duplicate by position (regex overlap)
    amounts.sort(key=lambda x: x[1])
    deduped = []
    last_pos = -10
    for val, pos in amounts:
        if pos - last_pos > 2:  # new position
            deduped.append(val)
        last_pos = pos

    if len(deduped) == 1:
        return deduped[0]

    if len(deduped) >= 2:
        # Usually: transaction amount, then balance
        # Transaction amount is typically the first dollar-sign amount
        # If first is smaller (absolute) than second, it's likely the txn amount
        # If they're close in value, prefer the first
        first, second = deduped[0], deduped[1]
        if abs(first) <= abs(second):
            return first
        # If first is larger, it might be a balance from previous line
        # In that case prefer the second (but this is less common)
        return first  # default: trust position
    
    return deduped[0]


def _looks_like_amount(text: str) -> bool:
    """Check if a string looks like a dollar amount."""
    text = text.strip()
    return bool(re.match(r"^[-($]?\s?\d{1,3}(?:,\d{3})*\.\d{2}\)?$", text))


def _should_skip(line: str) -> bool:
    """Check if a line is a header, footer, or summary."""
    for pattern in SKIP_PATTERNS:
        if pattern.search(line):
            return True
    if len(line.strip()) < 5:
        return True
    return False


def _guess_vendor(description: str) -> str:
    """Extract vendor name from description."""
    if not description:
        return "Unknown"

    # Remove common prefixes
    prefixes = [
        r"^(?:pos|debit|credit|ach|wire|check|chk|card|purchase|payment|transfer)\s+",
        r"^(?:recurring|online|mobile|bill)\s+(?:payment|purchase|debit)\s+",
        r"^(?:visa|mastercard|mc|discover)\s+",
        r"^(?:checkcard|debit\s+card|credit\s+card)\s+\d*\s*",
        r"^(?:external|internal)\s+(?:transfer|withdrawal|deposit)\s+",
        r"^(?:zelle|venmo|paypal|cashapp)\s+(?:payment\s+)?(?:to|from)\s+",
    ]
    clean = description
    for p in prefixes:
        clean = re.sub(p, "", clean, flags=re.I)
    clean = clean.strip()

    # Remove trailing reference numbers, dates, and location info
    clean = re.sub(r"\s+(?:ref|conf|trace|auth|seq|tran)[:\s#]*\S+\s*$", "", clean, flags=re.I)
    clean = re.sub(r"\s+\d{6,}\s*$", "", clean)
    clean = re.sub(r"\s+[A-Z]{2}\s+\d{5}(-\d{4})?\s*$", "", clean)  # state + zip
    clean = re.sub(r"\s+[A-Z]{2}\s*$", "", clean)  # state codes
    clean = re.sub(r"\s+\d{1,2}/\d{1,2}\s*$", "", clean)  # trailing date

    # Take meaningful words
    words = clean.split()
    noise = {"pos", "debit", "credit", "card", "purchase", "payment", "ach",
             "wire", "transfer", "ref", "#", "no.", "the", "at", "in", "on", "for",
             "to", "from", "via", "by", "check", "deposit"}
    meaningful = [w for w in words if w.lower() not in noise and len(w) > 1]

    if meaningful:
        return " ".join(meaningful[:5])
    return clean[:50] if clean else "Unknown"
