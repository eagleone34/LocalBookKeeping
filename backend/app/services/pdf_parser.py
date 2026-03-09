"""
PDF Statement Parser - Production-grade bank statement extraction.

Extracts:
  - Bank name and account number (learns and remembers)
  - All transactions with dates, descriptions, amounts
  - Handles table-format statements and line-by-line formats
  - Word-level extraction for PDFs with tight character spacing (e.g., RBC)
  - Uses pdfplumber for text + table extraction, falls back to OCR
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple, Dict

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
    # Canadian banks (check before US banks to avoid false positives)
    (re.compile(r"royal\s*bank\s*of\s*canada|royalbankofcanada|\brbc\b", re.I), "RBC"),
    (re.compile(r"toronto[- ]?dominion|\btd\s+canada\b", re.I), "TD Canada Trust"),
    (re.compile(r"bank\s*of\s*montreal|\bbmo\b", re.I), "BMO"),
    (re.compile(r"scotiabank|bank\s*of\s*nova\s*scotia", re.I), "Scotiabank"),
    (re.compile(r"\bcibc\b|canadian\s*imperial", re.I), "CIBC"),
    (re.compile(r"national\s*bank\s*of\s*canada|banque\s*nationale", re.I), "National Bank"),
    (re.compile(r"desjardins", re.I), "Desjardins"),
    (re.compile(r"\btangerine\b", re.I), "Tangerine"),
    (re.compile(r"\bsimplii\b", re.I), "Simplii Financial"),
    (re.compile(r"\beq\s*bank\b", re.I), "EQ Bank"),
    (re.compile(r"laurentian\s*bank|banque\s*laurentienne", re.I), "Laurentian Bank"),
    (re.compile(r"\bhsbc\s*canada\b", re.I), "HSBC Canada"),
    # US banks
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
    (re.compile(r"usaa", re.I), "USAA"),
    (re.compile(r"navy\s*federal", re.I), "Navy Federal"),
    # International
    (re.compile(r"\bhsbc\b", re.I), "HSBC"),
    (re.compile(r"\bbarclays\b", re.I), "Barclays"),
]

# Account number patterns - look for last 4 digits
ACCOUNT_NUM_PATTERNS = [
    # Canadian format: "Account number: 09231 101-694-8" → last 4 = "6948"
    re.compile(r"account\s*(?:#|number|no\.?|num)?[:\s]*[\d\s]+-(\d{3})-?(\d)(?:\s|$)", re.I),
    # Standard patterns
    re.compile(r"account\s*(?:#|number|no\.?|num)?[:\s]*[*xX.\-]*(\d{4})\b", re.I),
    re.compile(r"acct\.?[:\s#]*[*xX.\-]*(\d{4})\b", re.I),
    re.compile(r"(?:ending\s+in|last\s+4|last\s+four)[:\s]*(\d{4})", re.I),
    re.compile(r"[*xX]{3,}\s*(\d{4})", re.I),
    re.compile(r"(?:card|member)\s*(?:number|#|no\.?)?[:\s]*(?:\d[\d\s*-]+)?(\d{4})\s*$", re.I | re.M),
    re.compile(r"x{2,}\d*(\d{4})", re.I),
    re.compile(r"\.\.\.\s*(\d{4})", re.I),
]

FULL_ACCOUNT_PATTERNS = [
    # Canadian format: "09231 101-694-8"
    re.compile(r"account\s*(?:#|number|no\.?)?[:\s]*([\d]{4,5}\s+[\d]+-[\d]+-[\d]+)", re.I),
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
    # Canadian DD Mon format (no year): "01 Dec", "04 Dec", "01Dec", "04Dec"
    re.compile(r"\b(\d{1,2}\s*[A-Z][a-z]{2})\b"),
]

# Amount patterns
AMOUNT_PATTERNS = [
    re.compile(r"[-]?\$\s?\d{1,3}(?:,\d{3})*\.\d{2}"),
    re.compile(r"\(\$?\s?\d{1,3}(?:,\d{3})*\.\d{2}\)"),  # parentheses = negative
    re.compile(r"[-]?\d{1,3}(?:,\d{3})*\.\d{2}"),
]

# Lines/sections to skip
SKIP_PATTERNS = [
    re.compile(r"^opening\s*balance$", re.I),
    re.compile(r"^closing\s*balance$", re.I),
    re.compile(r"^beginning\s*balance$", re.I),
    re.compile(r"^ending\s*balance$", re.I),
    re.compile(r"statement\s*period", re.I),
    re.compile(r"page \d+\s*(of\s*\d+)?", re.I),
    re.compile(r"^\s*date\s+(description|details)", re.I),
    re.compile(r"^\s*trans\.?\s*date", re.I),
    re.compile(r"^\s*post\.?\s*date", re.I),
    re.compile(r"continued on", re.I),
    re.compile(r"previous statement", re.I),
    re.compile(r"new balance", re.I),
    re.compile(r"minimum payment", re.I),
    re.compile(r"payment due", re.I),
    re.compile(r"total\s+(charges|credits|debits|deposits|fees|interest|withdrawals|payments|cheques|debit)", re.I),
    re.compile(r"^interest\s+charged\s*$", re.I),
    re.compile(r"annual\s+percentage", re.I),
    re.compile(r"customer\s+service", re.I),
    re.compile(r"^(subtotal|balance\s*forward)$", re.I),
    re.compile(r"^\s*$"),
    re.compile(r"^account\s*(summary|activity|fees)", re.I),
]

# Month abbreviations for parsing "DDMon" format
MONTH_MAP = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


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

    all_text, tables, page_texts, page_words = _extract_all(path)

    info = StatementInfo()

    # For bank/account detection, also try the word-spaced text
    # (fixes PDFs where default extract_text() concatenates words)
    word_text = _words_to_spaced_text(page_words) if page_words else ""
    detection_text = all_text + "\n" + word_text

    info.bank_name = _detect_bank(detection_text)
    info.account_last_four = _detect_account_last_four(detection_text)
    info.account_full_number = _detect_full_account(detection_text)
    info.statement_period = _detect_statement_period(detection_text)

    # Try table extraction first (most accurate for statements with grid lines)
    txns = _parse_tables(tables)

    # If tables didn't yield much, try word-level extraction
    # (best for PDFs like RBC where text runs together but words are separate)
    if len(txns) < 2 and page_words:
        txns = _parse_word_rows(page_words, info)

    # If word-level didn't work either, try line-by-line on spaced text
    if len(txns) < 2 and word_text:
        txns = _parse_lines(word_text.splitlines(), info)

    # Last resort: line-by-line on raw text
    if len(txns) < 2:
        txns = _parse_lines(all_text.splitlines(), info)

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

def _extract_all(path: Path) -> Tuple[str, list, List[str], List[list]]:
    """Extract full text, tables, per-page text, and per-page words from PDF."""
    if not pdfplumber:
        return "", [], [], []

    all_lines = []
    tables = []
    page_texts = []
    page_words = []

    try:
        with pdfplumber.open(str(path)) as pdf:
            for page in pdf.pages:
                # Extract text (default)
                text = page.extract_text() or ""
                all_lines.append(text)
                page_texts.append(text)

                # Extract individual words with tight tolerance
                # This is critical for PDFs where characters are spaced tightly
                try:
                    words = page.extract_words(
                        x_tolerance=1,
                        y_tolerance=1,
                        keep_blank_chars=False,
                    )
                    page_words.append(words)
                except Exception:
                    page_words.append([])

                # Extract tables with custom settings for better detection
                try:
                    ts = {
                        "vertical_strategy": "lines",
                        "horizontal_strategy": "lines",
                        "snap_tolerance": 5,
                    }
                    page_tables = page.extract_tables(table_settings=ts) or []
                    if not page_tables:
                        page_tables = page.extract_tables() or []

                    for tbl in page_tables:
                        if tbl and len(tbl) > 1:
                            tables.append(tbl)
                except Exception:
                    try:
                        page_tables = page.extract_tables() or []
                        for tbl in page_tables:
                            if tbl and len(tbl) > 1:
                                tables.append(tbl)
                    except Exception:
                        pass
    except Exception:
        ocr_text = _ocr_extract(path)
        all_lines = [ocr_text]
        page_texts = [ocr_text]

    return "\n".join(all_lines), tables, page_texts, page_words


def _words_to_spaced_text(page_words: List[list]) -> str:
    """Convert word-level extraction to properly spaced text lines."""
    all_lines = []
    for words in page_words:
        if not words:
            continue
        # Group words by y-position (same row)
        rows: Dict[float, list] = {}
        for w in words:
            top = round(w['top'], 0)
            # Find nearby row (within 3 units tolerance)
            matched = False
            for existing_top in list(rows.keys()):
                if abs(existing_top - top) <= 3:
                    rows[existing_top].append(w)
                    matched = True
                    break
            if not matched:
                rows[top] = [w]

        for top in sorted(rows.keys()):
            row_words = sorted(rows[top], key=lambda w: w['x0'])
            line = " ".join(w['text'] for w in row_words)
            all_lines.append(line)
    return "\n".join(all_lines)


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
    header = text[:5000]
    for pattern, name in BANK_PATTERNS:
        if pattern.search(header):
            return name
    for pattern, name in BANK_PATTERNS:
        if pattern.search(text):
            return name
    return ""


def _detect_account_last_four(text: str) -> str:
    """Detect last 4 digits of account number."""
    header = text[:6000]

    # Special Canadian format: "Account number: 09231 101-694-8"
    # Last four = last 4 digits ignoring hyphens/spaces
    ca_pattern = re.compile(
        r"account\s*(?:#|number|no\.?|num)?[:\s]*([\d]+[\s-]+[\d]+-[\d]+-[\d]+)",
        re.I,
    )
    m = ca_pattern.search(header)
    if m:
        digits = re.sub(r"[^\d]", "", m.group(1))
        if len(digits) >= 4:
            return digits[-4:]

    # Standard patterns
    for pattern in ACCOUNT_NUM_PATTERNS:
        m = pattern.search(header)
        if m:
            groups = m.groups()
            if len(groups) == 2:
                # Canadian hyphenated format: groups are (3-digit, 1-digit)
                return groups[0][-3:] + groups[1]
            return groups[0]

    for pattern in ACCOUNT_NUM_PATTERNS:
        m = pattern.search(text)
        if m:
            groups = m.groups()
            if len(groups) == 2:
                return groups[0][-3:] + groups[1]
            return groups[0]
    return ""


def _detect_full_account(text: str) -> str:
    """Try to find full account number."""
    header = text[:6000]
    for pattern in FULL_ACCOUNT_PATTERNS:
        m = pattern.search(header)
        if m:
            return m.group(1)
    return ""


def _detect_statement_period(text: str) -> str:
    """Try to detect statement period from text."""
    header = text[:5000]
    period_patterns = [
        re.compile(r"statement\s+period[:\s]*(.+?)(?:\n|$)", re.I),
        re.compile(r"(?:for\s+)?period[:\s]+(\w+\s+\d{1,2},?\s+\d{4}\s*(?:to|-|through)\s*\w+\s+\d{1,2},?\s+\d{4})", re.I),
        re.compile(r"(\w+\s+\d{1,2},?\s+\d{4})\s*(?:to|-|through)\s*(\w+\s+\d{1,2},?\s+\d{4})", re.I),
        # Canadian format: "December 1, 2025 to January 2, 2026"
        re.compile(r"(\w+\s*\d{1,2}\s*,?\s*\d{4})\s*to\s*(\w+\s*\d{1,2}\s*,?\s*\d{4})", re.I),
    ]
    for pattern in period_patterns:
        m = pattern.search(header)
        if m:
            return m.group(0).strip()[:100]
    return ""


# -------------------------------------------------------
#  WORD-LEVEL ROW PARSING (for PDFs with tight spacing)
# -------------------------------------------------------

def _parse_word_rows(page_words: List[list], info: StatementInfo) -> List[ParsedTransaction]:
    """
    Parse transactions using word-level extraction.
    This handles PDFs where extract_text() concatenates words (e.g., RBC).
    
    Strategy: group words into rows by y-position, then identify columns by
    x-position. Date words appear at x<80, descriptions at x~90-300,
    amounts at x>300.
    
    Key insight: continuation lines (no date) that have their OWN amount
    are separate transactions sharing the previous date, not description
    continuations of the prior transaction. Only lines with NO amount
    are true description continuations.
    """
    results = []

    for words in page_words:
        if not words:
            continue

        # Group words into rows by y-position
        rows = _group_words_into_rows(words)

        # Find the header row to determine column boundaries
        col_bounds = _detect_column_boundaries(rows)
        if not col_bounds:
            continue

        # Parse transaction rows
        last_date = None
        i = 0
        sorted_tops = sorted(rows.keys())

        while i < len(sorted_tops):
            top = sorted_tops[i]
            row_words = sorted(rows[top], key=lambda w: w['x0'])

            # Build a readable line from this row
            line_text = " ".join(w['text'] for w in row_words)

            # Skip headers, summaries, etc.
            if _should_skip_word_row(line_text):
                i += 1
                continue

            # Try to extract a date from the leftmost words
            date_str = _extract_date_from_row_words(row_words, col_bounds, info)

            # Extract amounts from words in the amount columns
            debit, credit, balance = _extract_amounts_from_row(row_words, col_bounds)

            # Determine if this is a transaction row
            has_amount = (debit is not None and debit != 0) or (credit is not None and credit != 0)

            if date_str:
                last_date = date_str
            elif not has_amount:
                # No date and no amount => skip (pure text line like closing balance)
                i += 1
                continue

            # Use current date or inherited date from previous dated row
            effective_date = date_str or last_date
            if not effective_date:
                i += 1
                continue

            # Collect description words for this row
            desc_words = _collect_description_words(row_words, col_bounds)
            desc = " ".join(desc_words)

            # Look ahead for pure continuation lines (no date AND no amount)
            # These are description-only lines that belong to this transaction
            lookahead = 1
            while i + lookahead < len(sorted_tops):
                next_top = sorted_tops[i + lookahead]
                next_words = sorted(rows[next_top], key=lambda w: w['x0'])
                next_line = " ".join(w['text'] for w in next_words)

                if _should_skip_word_row(next_line):
                    lookahead += 1
                    continue

                next_date = _extract_date_from_row_words(next_words, col_bounds, info)
                if next_date:
                    break  # New dated row = new transaction

                next_debit, next_credit, _ = _extract_amounts_from_row(next_words, col_bounds)
                next_has_amount = (next_debit is not None and next_debit != 0) or \
                                  (next_credit is not None and next_credit != 0)

                if next_has_amount:
                    break  # Continuation with own amount = separate transaction

                # Pure description continuation (no date, no amount)
                next_desc_words = _collect_description_words(next_words, col_bounds)
                if next_desc_words:
                    desc += " " + " ".join(next_desc_words)
                lookahead += 1

            # Determine amount
            amount = None
            if debit is not None and debit != 0:
                amount = -abs(debit)
            elif credit is not None and credit != 0:
                amount = abs(credit)

            if amount is not None and desc and len(desc) >= 2:
                vendor = _guess_vendor(desc)
                results.append(ParsedTransaction(
                    txn_date=effective_date,
                    description=desc[:200],
                    amount=round(amount, 2),
                    vendor_name=vendor,
                    raw_line=line_text[:300],
                    balance=balance,
                ))

            i += lookahead

    return results


def _group_words_into_rows(words: list) -> Dict[float, list]:
    """Group words into rows by y-position with tolerance."""
    rows: Dict[float, list] = {}
    for w in words:
        top = round(w['top'], 0)
        matched = False
        for existing_top in list(rows.keys()):
            if abs(existing_top - top) <= 3:
                rows[existing_top].append(w)
                matched = True
                break
        if not matched:
            rows[top] = [w]
    return rows


def _detect_column_boundaries(rows: Dict[float, list]) -> Optional[dict]:
    """
    Detect column boundaries from the header row.
    Returns dict with approximate x-ranges for date, description, debit, credit, balance.
    """
    for top in sorted(rows.keys()):
        row_words = sorted(rows[top], key=lambda w: w['x0'])
        line_lower = " ".join(w['text'].lower() for w in row_words)

        # Look for header-like row
        if ("date" in line_lower and "description" in line_lower) or \
           ("date" in line_lower and ("debit" in line_lower or "cheque" in line_lower)) or \
           ("date" in line_lower and "balance" in line_lower):

            bounds = {"date_max_x": 85, "desc_min_x": 85, "desc_max_x": 300}

            for w in row_words:
                txt = w['text'].lower()
                if "date" in txt:
                    bounds["date_max_x"] = w['x1'] + 10
                    bounds["desc_min_x"] = w['x1'] + 10
                elif "description" in txt or "detail" in txt:
                    bounds["desc_min_x"] = w['x0'] - 5
                elif any(k in txt for k in ["cheque", "debit", "withdrawal", "charge"]):
                    bounds["desc_max_x"] = w['x0'] - 5
                    bounds["debit_min_x"] = w['x0'] - 10
                    bounds["debit_max_x"] = w['x1'] + 30
                elif any(k in txt for k in ["deposit", "credit"]):
                    bounds["credit_min_x"] = w['x0'] - 10
                    bounds["credit_max_x"] = w['x1'] + 30
                elif "balance" in txt:
                    bounds["balance_min_x"] = w['x0'] - 10

            # Set defaults if not found
            bounds.setdefault("debit_min_x", 300)
            bounds.setdefault("debit_max_x", 420)
            bounds.setdefault("credit_min_x", 400)
            bounds.setdefault("credit_max_x", 530)
            bounds.setdefault("balance_min_x", 530)

            return bounds

    # If no header found, use generic layout for common banks
    # (date < 85, desc 85-300, amounts > 300, balance > 530)
    return {
        "date_max_x": 85,
        "desc_min_x": 85,
        "desc_max_x": 310,
        "debit_min_x": 310,
        "debit_max_x": 420,
        "credit_min_x": 400,
        "credit_max_x": 530,
        "balance_min_x": 530,
    }


def _extract_date_from_row_words(row_words: list, col_bounds: dict, info_or_year) -> Optional[str]:
    """Extract a date from the leftmost words in a row."""
    date_words = [w for w in row_words if w['x0'] < col_bounds.get("date_max_x", 85)]
    if not date_words:
        return None

    date_text = " ".join(w['text'] for w in sorted(date_words, key=lambda w: w['x0']))
    date_text = date_text.strip()

    if not date_text or not any(c.isdigit() for c in date_text):
        return None

    # Try standard date normalization first
    result = _normalize_date(date_text)
    if result:
        return result

    # Try DDMon / DD Mon format (e.g., "01 Dec", "01Dec", "04 Dec")
    result = _parse_ddmon_date(date_text, info_or_year)
    if result:
        return result

    return None


def _parse_ddmon_date(text: str, info_or_year) -> Optional[str]:
    """Parse dates in DD Mon format (e.g., '01 Dec', '01Dec', '15Dec').
    
    info_or_year can be a StatementInfo (for smart year inference) or an int year.
    """
    text = text.strip()
    m = re.match(r'^(\d{1,2})\s*([A-Za-z]{3})$', text)
    if not m:
        return None
    day = int(m.group(1))
    mon_str = m.group(2).lower()
    month = MONTH_MAP.get(mon_str)
    if not month or day < 1 or day > 31:
        return None

    # Determine year
    if isinstance(info_or_year, int):
        year = info_or_year
    else:
        year = _infer_date_year_from_period(month, info_or_year)

    try:
        dt = datetime(year, month, day)
        return dt.strftime("%Y-%m-%d")
    except ValueError:
        return None


def _collect_description_words(row_words: list, col_bounds: dict) -> List[str]:
    """Collect words that fall in the description column."""
    desc_min = col_bounds.get("desc_min_x", 85)
    desc_max = col_bounds.get("desc_max_x", 300)
    desc_words = []
    for w in sorted(row_words, key=lambda w: w['x0']):
        # Words in the description area (between date and amount columns)
        if w['x0'] >= desc_min - 5 and w['x1'] <= desc_max + 100:
            # Exclude words that look like amounts
            if not _looks_like_amount(w['text']):
                desc_words.append(w['text'])
    return desc_words


def _extract_amounts_from_row(row_words: list, col_bounds: dict) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    """Extract debit, credit, and balance amounts from row words."""
    debit_min = col_bounds.get("debit_min_x", 300)
    debit_max = col_bounds.get("debit_max_x", 420)
    credit_min = col_bounds.get("credit_min_x", 400)
    credit_max = col_bounds.get("credit_max_x", 530)
    balance_min = col_bounds.get("balance_min_x", 530)

    # Collect amount words in each zone
    debit_texts = []
    credit_texts = []
    balance_texts = []

    for w in sorted(row_words, key=lambda w: w['x0']):
        x_mid = (w['x0'] + w['x1']) / 2
        txt = w['text'].strip()
        if not txt:
            continue

        if x_mid >= balance_min:
            balance_texts.append(txt)
        elif x_mid >= credit_min:
            credit_texts.append(txt)
        elif x_mid >= debit_min:
            debit_texts.append(txt)

    debit = _parse_amount("".join(debit_texts)) if debit_texts else None
    credit = _parse_amount("".join(credit_texts)) if credit_texts else None
    balance = _parse_amount("".join(balance_texts)) if balance_texts else None

    return debit, credit, balance


def _should_skip_word_row(line: str) -> bool:
    """Check if a word row should be skipped."""
    line_lower = line.strip().lower()
    if not line_lower or len(line_lower) < 3:
        return True
    skip_terms = [
        "opening balance", "closing balance", "beginning balance", "ending balance",
        "account summary", "account activity", "account fees",
        "total deposits", "total cheques", "total debits", "total credits",
        "total withdrawals", "total charges",
        "page ", "continued on", "how to reach",
        "please contact", "www.", "http",
    ]
    for term in skip_terms:
        if term in line_lower:
            return True
    # Skip if it's just a header row
    if "date" in line_lower and ("description" in line_lower or "balance" in line_lower):
        return True
    return False


def _infer_statement_year(info: StatementInfo) -> int:
    """Infer the year from the statement period or use current year."""
    if info.statement_period:
        years = re.findall(r"20\d{2}", info.statement_period)
        if years:
            return int(years[0])  # Use the first (start) year
    return datetime.now().year


def _infer_date_year_from_period(month: int, info: StatementInfo) -> int:
    """
    Infer the correct year for a DDMon date using the statement period.
    Handles cross-year statements (e.g., Dec 2025 to Jan 2026).
    """
    if not info.statement_period:
        return datetime.now().year

    # Extract month-year pairs from period, sorted by position in text
    period_lower = info.statement_period.lower()
    month_year_pairs = []
    for mon_name, mon_num in MONTH_MAP.items():
        pat = re.compile(rf"{mon_name}\w*\s*\d{{0,2}}\s*,?\s*(20\d{{2}})", re.I)
        for m in pat.finditer(period_lower):
            month_year_pairs.append((m.start(), mon_num, int(m.group(1))))

    # Sort by position in text (start date first, end date second)
    month_year_pairs.sort(key=lambda x: x[0])

    if len(month_year_pairs) >= 2:
        _, start_month, start_year = month_year_pairs[0]
        _, end_month, end_year = month_year_pairs[-1]

        # If cross-year (e.g., Dec 2025 to Jan 2026)
        if start_year != end_year:
            if month >= start_month:
                return start_year
            else:
                return end_year

        return start_year

    if month_year_pairs:
        return month_year_pairs[0][2]

    years = re.findall(r"20\d{2}", info.statement_period)
    if years:
        return int(years[0])

    return datetime.now().year


# -------------------------------------------------------
#  TABLE PARSING (most accurate for bank statements)
# -------------------------------------------------------

def _parse_tables(tables: list) -> List[ParsedTransaction]:
    """Parse structured tables extracted by pdfplumber."""
    results = []
    for table in tables:
        if not table or len(table) < 2:
            continue

        header = table[0]
        if not header:
            continue

        col_map = _identify_columns(header)
        if not col_map.get("date") and not col_map.get("amount") and not col_map.get("debit"):
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
        elif any(w in cell_lower for w in ["debit", "withdrawal", "charge", "payment", "money out", "cheque"]):
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
        date_str = None
        if "date" in col_map and col_map["date"] < len(row):
            raw = str(row[col_map["date"]] or "").strip()
            date_str = _normalize_date(raw)

        if not date_str:
            for cell in row:
                if cell:
                    d = _normalize_date(str(cell).strip())
                    if d:
                        date_str = d
                        break

        if not date_str:
            return None

        desc = ""
        if "description" in col_map and col_map["description"] < len(row):
            desc = str(row[col_map["description"]] or "").strip()
        else:
            best = ""
            for i, cell in enumerate(row):
                s = str(cell or "").strip()
                if len(s) > len(best) and not _looks_like_amount(s) and not _normalize_date(s):
                    best = s
            desc = best

        if not desc or len(desc) < 2:
            return None

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

        if _should_skip(desc):
            return None

        vendor = _guess_vendor(desc)
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

def _parse_lines(lines: List[str], info: Optional[StatementInfo] = None) -> List[ParsedTransaction]:
    """Parse transactions from raw text lines."""
    results = []
    effective_info = info or StatementInfo()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line or len(line) < 5:
            i += 1
            continue

        if _should_skip(line):
            i += 1
            continue

        # Try to parse this line
        date_str = _extract_date_from_line(line)
        # Also try DDMon format
        if not date_str:
            m = re.match(r'^(\d{1,2}\s*[A-Za-z]{3})\b', line)
            if m:
                date_str = _parse_ddmon_date(m.group(1), effective_info)

        if not date_str:
            i += 1
            continue

        # Collect the full description (may span multiple lines)
        full_text = line
        lookahead = 1
        while i + lookahead < len(lines) and lookahead <= 3:
            next_line = lines[i + lookahead].strip()
            if not next_line:
                lookahead += 1
                continue
            next_date = _extract_date_from_line(next_line)
            if not next_date:
                m = re.match(r'^(\d{1,2}\s*[A-Za-z]{3})\b', next_line)
                if m:
                    next_date = _parse_ddmon_date(m.group(1), effective_info)
            if next_date:
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
        # Also remove DDMon patterns from start
        desc = re.sub(r"^\d{1,2}\s*[A-Za-z]{3}\s*", "", desc)
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
    if len(text) < 5 or not any(c.isdigit() for c in text):
        return None
    formats = [
        "%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d", "%m-%d-%Y", "%m-%d-%y",
        "%b %d, %Y", "%b %d %Y", "%d %b %Y",
        "%B %d, %Y", "%B %d %Y",
        "%d %B %Y", "%B %d,%Y",
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(text, fmt)
            if dt.year < 100:
                dt = dt.replace(year=dt.year + 2000)
            if 2000 <= dt.year <= 2035:
                return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    for pattern in DATE_PATTERNS[:-1]:  # Skip the DDMon pattern (last one)
        m = pattern.search(text)
        if m and m.group(1) != text:
            return _normalize_date(m.group(1))
    return None


def _extract_date_from_line(line: str) -> Optional[str]:
    """Extract and normalize a date from a text line."""
    for pattern in DATE_PATTERNS[:-1]:  # Skip DDMon pattern
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
    # Remove trailing non-numeric characters
    text = re.sub(r"[^0-9.\-]$", "", text)
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

    amounts.sort(key=lambda x: x[1])
    deduped = []
    last_pos = -10
    for val, pos in amounts:
        if pos - last_pos > 2:
            deduped.append(val)
        last_pos = pos

    if len(deduped) == 1:
        return deduped[0]

    if len(deduped) >= 2:
        first, second = deduped[0], deduped[1]
        if abs(first) <= abs(second):
            return first
        return first
    
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

    # Remove common prefixes (including Canadian bank-specific ones)
    prefixes = [
        r"^(?:pos|debit|credit|ach|wire|check|chk|card|purchase|payment|transfer)\s+",
        r"^(?:recurring|online|mobile|bill)\s+(?:payment|purchase|debit)\s+",
        r"^(?:visa|mastercard|mc|discover|interac)\s+",
        r"^(?:checkcard|debit\s+card|credit\s+card)\s+\d*\s*",
        r"^(?:external|internal)\s+(?:transfer|withdrawal|deposit)\s+",
        r"^(?:zelle|venmo|paypal|cashapp)\s+(?:payment\s+)?(?:to|from)\s+",
        r"^(?:e-?transfer\s+(?:sent|received|from|to))\s+",
        r"^(?:bill\s*payment|misc\s*payment)\s+",
    ]
    clean = description
    for p in prefixes:
        clean = re.sub(p, "", clean, flags=re.I)
    clean = clean.strip()

    # Remove trailing reference numbers, dates, and location info
    clean = re.sub(r"\s+(?:ref|conf|trace|auth|seq|tran)[:\s#]*\S+\s*$", "", clean, flags=re.I)
    clean = re.sub(r"\s+\d{6,}\s*$", "", clean)
    clean = re.sub(r"\s+[A-Z]{2}\s+\d{5}(-\d{4})?\s*$", "", clean)
    clean = re.sub(r"\s+[A-Z]{2}\s*$", "", clean)
    clean = re.sub(r"\s+\d{1,2}/\d{1,2}\s*$", "", clean)
    # Remove <DEFTPYMT> style tags
    clean = re.sub(r"\s*<[^>]+>\s*", " ", clean)
    # Remove trailing numbers (reference codes)
    clean = re.sub(r"\s+\d{3,}$", "", clean)

    words = clean.split()
    noise = {"pos", "debit", "credit", "card", "purchase", "payment", "ach",
             "wire", "transfer", "ref", "#", "no.", "the", "at", "in", "on", "for",
             "to", "from", "via", "by", "check", "deposit", "sent", "received",
             "misc", "bill", "e-transfer"}
    meaningful = [w for w in words if w.lower() not in noise and len(w) > 1]

    if meaningful:
        return " ".join(meaningful[:5])
    return clean[:50] if clean else "Unknown"
