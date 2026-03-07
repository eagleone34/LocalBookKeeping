from __future__ import annotations

import re
import sqlite3
from typing import Optional, Tuple


def suggest_account(
    connection: sqlite3.Connection,
    company_id: int,
    description: str,
    vendor_name: str,
) -> Tuple[Optional[int], float]:
    text = f"{vendor_name or ''} {description or ''}".strip().lower()
    if not text:
        return None, 0.0

    cursor = connection.cursor()
    cursor.execute(
        """
        SELECT account_id, pattern, priority
        FROM categorization_rules
        WHERE company_id = ? AND is_active = 1
        ORDER BY priority ASC
        """,
        (company_id,),
    )
    for row in cursor.fetchall():
        pattern = row["pattern"].lower()
        if pattern in text or re.search(pattern, text):
            return int(row["account_id"]), 0.9

    cursor.execute(
        """
        SELECT account_id, COUNT(*) AS hits
        FROM transactions
        JOIN vendors ON transactions.vendor_id = vendors.id
        WHERE transactions.company_id = ? AND vendors.name = ?
        GROUP BY account_id
        ORDER BY hits DESC
        LIMIT 1
        """,
        (company_id, vendor_name),
    )
    row = cursor.fetchone()
    if row:
        return int(row["account_id"]), 0.7

    return None, 0.2
