"""
Transactions API endpoints.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from app.models import (
    TransactionCreate, TransactionOut, TransactionUpdate, BulkRecategorize,
    SuggestCategoriesRequest, SuggestCategoriesResponse, CategorySuggestionGroup,
)
from app.main_state import get_conn, get_company_id
from app.services import data_service as ds
from app.services import categorization

router = APIRouter(prefix="/api/transactions", tags=["transactions"])


@router.get("", response_model=List[TransactionOut])
def list_transactions(
    account_id: Optional[int] = None,
    category_id: Optional[int] = None,
    vendor_id: Optional[int] = None,
    bank_account_id: Optional[int] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = Query(500, le=5000),
    offset: int = 0,
):
    rows = ds.list_transactions(
        get_conn(), get_company_id(),
        account_id=account_id, category_id=category_id, vendor_id=vendor_id, bank_account_id=bank_account_id, search=search,
        date_from=date_from, date_to=date_to, limit=limit, offset=offset,
    )
    return [_to_out(r) for r in rows]


@router.get("/count")
def count_transactions():
    return {"count": ds.count_transactions(get_conn(), get_company_id())}


@router.post("", response_model=TransactionOut, status_code=201)
def create_transaction(body: TransactionCreate):
    tid = ds.create_transaction(
        get_conn(), get_company_id(),
        account_id=body.account_id, txn_date=body.txn_date,
        amount=body.amount, description=body.description or "",
        memo=body.memo or "", vendor_name=body.vendor_name or "",
        source=body.source,
    )
    rows = ds.list_transactions(get_conn(), get_company_id(), limit=1)
    # Find the one we just created
    for r in rows:
        if r["id"] == tid:
            return _to_out(r)
    # Fallback
    rows = ds.list_transactions(get_conn(), get_company_id(), limit=1000)
    for r in rows:
        if r["id"] == tid:
            return _to_out(r)
    raise HTTPException(500, "Transaction created but not found")


@router.put("/{txn_id}", response_model=TransactionOut)
def update_transaction(txn_id: int, body: TransactionUpdate):
    kwargs = body.model_dump(exclude_none=True)
    ds.update_transaction(get_conn(), get_company_id(), txn_id, **kwargs)
    # Return the updated transaction
    rows = ds.list_transactions(get_conn(), get_company_id(), limit=5000)
    for r in rows:
        if r["id"] == txn_id:
            return _to_out(r)
    raise HTTPException(404, "Transaction not found after update")


@router.delete("/{txn_id}")
def delete_transaction(txn_id: int):
    ds.delete_transaction(get_conn(), txn_id)
    return {"ok": True}


@router.post("/bulk-recategorize")
def bulk_recategorize(body: BulkRecategorize):
    count = ds.bulk_recategorize(get_conn(), body.transaction_ids, body.category_id)
    return {"updated": count}


@router.post("/suggest-categories", response_model=SuggestCategoriesResponse)
def suggest_categories(body: SuggestCategoriesRequest):
    """
    Analyze a batch of incoming transactions and suggest categories
    based on similar past transactions, vendor matching, and keyword heuristics.

    Groups similar transactions together so the user can categorize them in bulk.
    """
    conn = get_conn()
    company_id = get_company_id()

    # Convert Pydantic models to plain dicts for the categorization engine
    txn_dicts = [
        {
            "description": t.description,
            "amount": t.amount,
            "date": t.date,
        }
        for t in body.transactions
    ]

    result = categorization.suggest_categories_for_batch(
        conn, company_id, txn_dicts, body.bank_account_id,
    )

    # Convert to response model
    groups = [
        CategorySuggestionGroup(
            group_key=g["group_key"],
            sample_description=g["sample_description"],
            transaction_indices=g["transaction_indices"],
            suggested_category_id=g.get("suggested_category_id"),
            suggested_category_name=g.get("suggested_category_name"),
            confidence=g.get("confidence", 0.0),
            match_reason=g.get("match_reason", ""),
        )
        for g in result["groups"]
    ]

    return SuggestCategoriesResponse(
        groups=groups,
        ungrouped_indices=result["ungrouped_indices"],
    )


def _to_out(row: dict) -> TransactionOut:
    return TransactionOut(
        id=row["id"],
        account_id=row["account_id"],
        account_name=row.get("account_name", ""),
        account_type=row.get("account_type", ""),
        category_id=row.get("account_id"),  # Map to account_id
        category_name=row.get("account_name"),  # Map to account_name
        category_type=row.get("account_type"),  # Map to account_type
        vendor_id=row.get("vendor_id"),
        vendor_name=row.get("vendor_name"),
        txn_date=row["txn_date"],
        description=row.get("description"),
        memo=row.get("memo"),
        amount=row["amount"],
        is_posted=bool(row.get("is_posted", True)),
        source=row.get("source", "manual"),
        source_doc_id=row.get("source_doc_id"),
        bank_account_id=row.get("bank_account_id"),
        bank_account_name=row.get("bank_account_name"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )
