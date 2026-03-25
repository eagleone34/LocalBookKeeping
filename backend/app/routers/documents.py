"""
Documents & PDF Inbox API endpoints.
Smart pipeline: upload -> extract -> detect bank -> detect duplicates -> categorize -> review
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Body, File, HTTPException, UploadFile

from app.models import DocumentOut, DocTransactionOut, DocTransactionAction, BulkDocTransactionAction, BulkImportRequest, MappedTransactionIn
from app.main_state import get_conn, get_company_id, get_upload_dir
from app.services import data_service as ds
from app.services.categorization import suggest_account
from app.services.pdf_parser import parse_statement, get_page_count

router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.get("", response_model=List[DocumentOut])
def list_documents():
    rows = ds.list_documents(get_conn(), get_company_id())
    return [_doc_out(r) for r in rows]


@router.delete("/{doc_id}")
def delete_document(doc_id: int):
    """Delete a document and all related staging/ledger data."""
    try:
        ds.delete_document(get_conn(), doc_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"ok": True}


@router.post("/upload", response_model=List[DocumentOut])
async def upload_documents(files: List[UploadFile] = File(...)):
    """Upload one or more PDF files. Full smart pipeline runs automatically."""
    conn = get_conn()
    cid = get_company_id()
    upload_dir = get_upload_dir()
    results = []

    for file in files:
        if not file.filename:
            continue

        # Save file
        safe_name = file.filename.replace(" ", "_")
        dest = upload_dir / safe_name
        counter = 1
        while dest.exists():
            stem = Path(safe_name).stem
            suffix = Path(safe_name).suffix
            dest = upload_dir / f"{stem}_{counter}{suffix}"
            counter += 1

        content = await file.read()
        dest.write_bytes(content)

        # Create document record
        doc_id = ds.create_document(conn, cid, file.filename, str(dest), len(content))

        # Immediately mark as processing so the record never gets stuck in 'pending'
        # if any subsequent step raises before entering the try block.
        ds.update_document(conn, doc_id, status="processing")

        try:
            # ═══ STEP 1: Parse the PDF ═══
            info = parse_statement(str(dest))
            pages = get_page_count(str(dest))
            ds.update_document(conn, doc_id, page_count=pages)

            # ═══ STEP 2: Detect bank account ═══
            bank_account_id = None
            if info.bank_name and info.account_last_four:
                # Find or create bank account mapping
                bank_account_id = ds.upsert_bank_account(
                    conn, cid,
                    bank_name=info.bank_name,
                    last_four=info.account_last_four,
                    full_number=info.account_full_number,
                )
                ds.update_document(conn, doc_id,
                    bank_name=info.bank_name,
                    account_last_four=info.account_last_four,
                    bank_account_id=bank_account_id,
                )
            elif info.bank_name:
                ds.update_document(conn, doc_id, bank_name=info.bank_name)
            elif info.account_last_four:
                ds.update_document(conn, doc_id, account_last_four=info.account_last_four)

            # ═══ STEP 3: Process each transaction ═══
            for entry in info.transactions:
                # 3a. Check for duplicates
                is_dup, dup_txn_id = ds.check_doc_transaction_duplicate(
                    conn, cid,
                    txn_date=entry.txn_date,
                    amount=entry.amount,
                    description=entry.description,
                )

                # 3b. Smart categorization (only suggests expense/income categories)
                acct_id, confidence = suggest_account(
                    conn, cid, entry.description, entry.vendor_name
                )

                # 3c. Create the document transaction
                # Note: We no longer fall back to the bank's ledger account as a category
                # because that would suggest an asset/liability account (bank account)
                # when the user expects an expense/income category.
                status = "duplicate" if is_dup else "review"
                dt_id = ds.create_doc_transaction(
                    conn, doc_id,
                    txn_date=entry.txn_date,
                    description=entry.description,
                    amount=entry.amount,
                    vendor_name=entry.vendor_name,
                    suggested_account_id=acct_id,
                    category_id=acct_id,  # Also set category_id for new schema
                    confidence=confidence,
                    bank_account_id=bank_account_id,
                )

                # Mark duplicate info
                if is_dup:
                    ds.update_doc_transaction(conn, dt_id,
                        is_duplicate=1,
                        duplicate_of_txn_id=dup_txn_id,
                        status="duplicate",
                    )

                # Link to bank account
                if bank_account_id:
                    ds.update_doc_transaction(conn, dt_id, bank_account_id=bank_account_id)

            status = "review" if info.transactions else "completed"
            ds.update_document(conn, doc_id, status=status, processed_at=ds._now())

        except Exception as e:
            ds.update_document(conn, doc_id, status="error", error_msg=str(e))

        row = ds.list_documents(conn, cid)
        for r in row:
            if r["id"] == doc_id:
                results.append(_doc_out(r))
                break

    return results


@router.post("/import-csv", response_model=List[DocumentOut])
def import_csv(body: BulkImportRequest):
    """Import pre-mapped CSV/Excel data directly into staging."""
    conn = get_conn()
    cid = get_company_id()
    
    # 1. Create a logical document to group these
    doc_id = ds.create_document(conn, cid, body.filename, "csv_import", len(body.transactions))
    
    try:
        # Determine bank account - new bank_account_id field takes precedence
        bank_account_id = None
        if getattr(body, "bank_account_id", None):
            # User explicitly selected a bank account
            bank_account_id = body.bank_account_id
            ds.update_document(conn, doc_id, bank_account_id=bank_account_id)
        elif getattr(body, "ledger_account_id", None):
            # Legacy: derive bank account from ledger account
            bank_account_id = ds.get_or_create_bank_for_ledger(conn, cid, body.ledger_account_id)
            ds.update_document(conn, doc_id, bank_account_id=bank_account_id)
        elif getattr(body, "bank_name", None) and getattr(body, "account_last_four", None):
            bank_account_id = ds.upsert_bank_account(
                conn, cid,
                bank_name=body.bank_name,
                last_four=body.account_last_four,
                full_number=""
            )
            ds.update_document(conn, doc_id,
                               bank_name=body.bank_name,
                               account_last_four=body.account_last_four,
                               bank_account_id=bank_account_id)
        
        # Get default category if provided
        default_category_id = getattr(body, "category_id", None)
        
        # 2. Process each mapped transaction
        for entry in body.transactions:
            # 2a. Duplicate check
            is_dup, dup_txn_id = ds.check_doc_transaction_duplicate(
                conn, cid,
                txn_date=entry.txn_date,
                amount=entry.amount,
                description=entry.description,
            )
            
            # 2b. Smart categorization (unless user provided a default category)
            if default_category_id:
                acct_id = default_category_id
                confidence = 0.9  # High confidence for user-selected default
            else:
                acct_id, confidence = suggest_account(
                    conn, cid, entry.description, entry.vendor_name
                )
            
            # 2c. Create staging record
            # Note: We no longer fall back to the bank's ledger account as a category
            # because that would suggest an asset/liability account (bank account)
            # when the user expects an expense/income category.
            dt_id = ds.create_doc_transaction(
                conn, doc_id,
                txn_date=entry.txn_date,
                description=entry.description,
                amount=entry.amount,
                vendor_name=entry.vendor_name,
                suggested_account_id=acct_id,
                category_id=acct_id,  # Also set category_id for new schema
                confidence=confidence,
                bank_account_id=bank_account_id,
            )
            
            if is_dup:
                ds.update_doc_transaction(conn, dt_id,
                                          is_duplicate=1,
                                          duplicate_of_txn_id=dup_txn_id,
                                          status="duplicate")
        
        status = "review" if body.transactions else "completed"
        ds.update_document(conn, doc_id, status=status, processed_at=ds._now())
        
    except Exception as e:
        ds.update_document(conn, doc_id, status="error", error_msg=str(e))
        raise HTTPException(500, str(e))
        
    # Return info
    row = ds.list_documents(conn, cid)
    for r in row:
        if r["id"] == doc_id:
            return [_doc_out(r)]
    return []


@router.get("/transactions", response_model=List[DocTransactionOut])
def list_doc_transactions(doc_id: Optional[int] = None, status: Optional[str] = None):
    rows = ds.list_doc_transactions(get_conn(), doc_id=doc_id, status=status, company_id=get_company_id())
    return [_dt_out(r) for r in rows]


@router.delete("/transactions/{dt_id}")
def delete_doc_transaction(dt_id: int):
    """Delete a single staging transaction."""
    ds.delete_doc_transaction(get_conn(), dt_id)
    return {"ok": True}


@router.post("/transactions/{dt_id}/action")
def action_doc_transaction(dt_id: int, body: DocTransactionAction):
    """Approve, reject, or revert a document transaction. Learning happens on approve."""
    conn = get_conn()
    cid = get_company_id()
    dt = ds.get_doc_transaction(conn, dt_id)
    if not dt:
        raise HTTPException(404, "Document transaction not found")

    if body.action == "approve":
        # Use category_id if provided, otherwise fall back to account_id for backward compatibility
        category_id = body.category_id or body.account_id or dt.get("user_category_id") or dt.get("category_id") or dt.get("user_account_id") or dt.get("suggested_account_id")
        if not category_id:
            raise HTTPException(400, "No category specified for approval")

        # Create transaction with proper Account/Category separation
        ds.create_transaction(
            conn, cid,
            account_id=category_id,
            txn_date=dt["txn_date"] or "2025-01-01",
            amount=dt["amount"] or 0,
            description=dt["description"] or "",
            vendor_name=dt["vendor_name"] or "",
            source="pdf_import",
            source_doc_id=dt["document_id"],
            bank_account_id=dt.get("bank_account_id"),
        )

        # Update both legacy and new fields for backward compatibility
        ds.update_doc_transaction(conn, dt_id, status="posted", category_id=category_id, user_account_id=category_id)

        # ═══ LEARNING: update vendor-account map so next time it auto-categorizes ═══
        if dt.get("vendor_name"):
            ds._update_vendor_account_map(conn, cid, dt["vendor_name"], category_id)

    elif body.action == "reject":
        ds.update_doc_transaction(conn, dt_id, status="rejected")

    elif body.action == "revert":
        if dt["status"] == "posted":
            # ═══ DATA INTEGRITY: delete BOTH entries (Category + Bank Asset) ═══
            # Match by source_doc_id + txn_date + amount + source='pdf_import'
            conn.execute(
                """DELETE FROM transactions
                   WHERE company_id=? AND source='pdf_import' AND source_doc_id=?
                   AND txn_date=? AND ABS(amount - ?) < 0.01""",
                (cid, dt["document_id"], dt["txn_date"], dt["amount"]),
            )
            conn.commit()
            # Reset status back to review and clear user_account_id
            ds.update_doc_transaction(conn, dt_id, status="review", user_account_id=None)
        elif dt["status"] == "rejected":
            # Simple revert — no ledger entry was created for rejected txns
            ds.update_doc_transaction(conn, dt_id, status="review")
        elif dt["status"] == "duplicate":
            # Clear duplicate flag and move to review
            ds.update_doc_transaction(conn, dt_id, status="review", is_duplicate=0, duplicate_of_txn_id=None)
        else:
            raise HTTPException(400, f"Cannot revert transaction with status '{dt['status']}'")

    return {"ok": True}


@router.post("/transactions/bulk-action")
def bulk_action(body: BulkDocTransactionAction):
    """Bulk approve or reject."""
    conn = get_conn()
    cid = get_company_id()
    processed = 0

    for dt_id in body.ids:
        dt = ds.get_doc_transaction(conn, dt_id)
        if not dt or dt["status"] not in ("review", "duplicate"):
            continue

        if body.action == "approve":
            # Use category_id if provided, otherwise fall back to account_id for backward compatibility
            category_id = body.category_id or body.account_id or dt.get("user_category_id") or dt.get("category_id") or dt.get("user_account_id") or dt.get("suggested_account_id")
            if not category_id:
                continue
            
            # Create transaction with proper Account/Category separation
            ds.create_transaction(
                conn, cid,
                account_id=category_id,
                txn_date=dt["txn_date"] or "2025-01-01",
                amount=dt["amount"] or 0,
                description=dt["description"] or "",
                vendor_name=dt["vendor_name"] or "",
                source="pdf_import",
                source_doc_id=dt["document_id"],
                bank_account_id=dt.get("bank_account_id"),
            )

            # Update both legacy and new fields for backward compatibility
            ds.update_doc_transaction(conn, dt_id, status="posted", category_id=category_id, user_account_id=category_id)
            # Learning
            if dt.get("vendor_name"):
                ds._update_vendor_account_map(conn, cid, dt["vendor_name"], category_id)
        elif body.action == "reject":
            ds.update_doc_transaction(conn, dt_id, status="rejected")
        processed += 1

    return {"processed": processed}


# ═══ Bank account management ═══

@router.get("/bank-accounts")
def list_bank_accounts():
    return ds.list_bank_accounts(get_conn(), get_company_id())


@router.post("/bank-accounts")
def create_bank_account(payload: dict = Body(...)):
    """Create a new bank account on the fly (e.g., from Import Wizard)."""
    bank_name = payload.get("bank_name", "").strip()
    last_four = payload.get("last_four", "").strip()
    if not bank_name:
        raise HTTPException(400, "bank_name is required")
    if not last_four:
        last_four = "0000"
    ba_id = ds.upsert_bank_account(get_conn(), get_company_id(), bank_name, last_four)
    # Return the created/found bank account
    ba = ds.get_bank_account(get_conn(), ba_id)
    return ba if ba else {"id": ba_id, "bank_name": bank_name, "last_four": last_four}


@router.put("/bank-accounts/{ba_id}")
def update_bank_account(ba_id: int, body: dict):
    """Update bank account mapping (e.g., set ledger_account_id)."""
    ds.update_bank_account(get_conn(), ba_id, **body)
    return {"ok": True}


# ═══ Output helpers ═══

def _doc_out(r: dict) -> DocumentOut:
    return DocumentOut(
        id=r["id"], filename=r["filename"], file_path=r["file_path"],
        file_size=r.get("file_size"), page_count=r.get("page_count"),
        status=r["status"], error_msg=r.get("error_msg"),
        imported_at=r["imported_at"], processed_at=r.get("processed_at"),
        bank_name=r.get("bank_name"),
        account_last_four=r.get("account_last_four"),
    )


def _dt_out(r: dict) -> DocTransactionOut:
    # Build bank account display name from bank_name + last_four
    bank_name = r.get("bank_account_name")
    last_four = r.get("bank_account_last_four")
    if bank_name and last_four:
        bank_account_name = f"{bank_name} ****{last_four}"
    elif bank_name:
        bank_account_name = bank_name
    else:
        bank_account_name = None
    
    # Use category fields if available, fall back to account fields for backward compatibility
    suggested_category_id = r.get("category_id") or r.get("suggested_account_id")
    suggested_category_name = r.get("category_name") or r.get("suggested_category_name") or r.get("suggested_account_name")
    user_category_id = r.get("user_category_id") or r.get("user_account_id")
    user_category_name = r.get("user_category_name") or r.get("user_account_name")
    
    return DocTransactionOut(
        id=r["id"], document_id=r["document_id"],
        txn_date=r.get("txn_date"), description=r.get("description"),
        amount=r.get("amount"), vendor_name=r.get("vendor_name"),
        # Legacy fields (deprecated)
        suggested_account_id=r.get("suggested_account_id"),
        suggested_account_name=r.get("suggested_account_name"),
        user_account_id=r.get("user_account_id"),
        user_account_name=r.get("user_account_name"),
        # New category fields
        suggested_category_id=suggested_category_id,
        suggested_category_name=suggested_category_name,
        user_category_id=user_category_id,
        user_category_name=user_category_name,
        confidence=r.get("confidence", 0),
        status=r["status"],
        is_duplicate=bool(r.get("is_duplicate", 0)),
        duplicate_of_txn_id=r.get("duplicate_of_txn_id"),
        bank_account_id=r.get("bank_account_id"),
        bank_account_name=bank_account_name,
    )
