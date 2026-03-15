# WaveApps-Style Account/Category Separation Design

## Executive Summary

This document outlines the design for separating **Account** (source of funds) from **Category** (Chart of Accounts classification) in LedgerLocal, following the WaveApps model. Currently, the schema has confusing terminology where `account_id` represents the COA category, not the bank account.

---

## 1. Current Schema Analysis

### 1.1 Database Tables (Current State)

#### `accounts` table (Chart of Accounts)
```sql
CREATE TABLE accounts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL REFERENCES company(id),
    name        TEXT NOT NULL,          -- e.g., "Professional Services", "Checking Account"
    type        TEXT NOT NULL CHECK(type IN ('income','expense','asset','liability')),
    parent_id   INTEGER REFERENCES accounts(id),
    code        TEXT,
    description TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
```

**Current usage:** Stores ALL accounts - both COA categories (expense/income) AND bank accounts (asset/liability).

#### `bank_accounts` table (Bank Statement Sources)
```sql
CREATE TABLE bank_accounts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL REFERENCES company(id),
    bank_name   TEXT NOT NULL,          -- e.g., "Chase", "Bank of America"
    last_four   TEXT NOT NULL,          -- Last 4 digits from statement
    full_number TEXT,
    nickname    TEXT,
    ledger_account_id INTEGER REFERENCES accounts(id),  -- Links to Asset/Liability COA
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
```

**Current usage:** Learns from PDF statements; stores detected bank info and links to COA account.

#### `transactions` table (The Problem Area)
```sql
CREATE TABLE transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL REFERENCES company(id),
    account_id  INTEGER NOT NULL REFERENCES accounts(id),  -- ❌ This is the COA CATEGORY, not bank account
    vendor_id   INTEGER REFERENCES vendors(id),
    txn_date    TEXT NOT NULL,
    description TEXT,
    memo        TEXT,
    amount      REAL NOT NULL,
    is_posted   INTEGER NOT NULL DEFAULT 1,
    source      TEXT NOT NULL DEFAULT 'manual',
    source_doc_id INTEGER REFERENCES documents(id),
    bank_account_id INTEGER REFERENCES bank_accounts(id),  -- Links to bank_accounts table
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
```

### 1.2 Current Problem

**Confusing Terminology:**
| What User Sees | What It Actually Is | Problem |
|---------------|---------------------|---------|
| Account column (showing "-") | `bank_account_name` from `bank_accounts` table | Often empty, confusing |
| Category column (showing "Professional Services") | `account_name` from `accounts` table | This is actually the COA category |

**The Issue:**
- `transactions.account_id` → Points to COA category (expense/income account)
- `transactions.bank_account_id` → Points to `bank_accounts` table (not COA)
- User expects: Account = Bank/Source, Category = COA classification

### 1.3 Current Transaction Flow

```
PDF Upload → Parse → Detect Bank → Create bank_account record
                ↓
        Create document_transactions (staging)
                ↓
        User approves → create_transaction()
                ↓
        INSERT INTO transactions:
          - account_id = COA category (expense/income account)
          - bank_account_id = bank_accounts.id (source)
```

### 1.4 Current UI Display (Transactions.jsx)

```jsx
// Lines 262-263: Table headers
<th>Account</th>   // Shows txn.bank_account_name
<th>Category</th>  // Shows txn.account_name with type badge

// Lines 345-349: Data display
<td>{txn.bank_account_name || '-'}</td>
<td><span className={`badge-${txn.account_type}`}>{txn.account_name}</span></td>
```

---

## 2. WaveApps-Style Design

### 2.1 Conceptual Model

| Concept | Definition | Example |
|---------|-----------|---------|
| **Account** | Source of funds - where money came from or went to | "Chase Business Checking ****1234", "Corporate Credit Card ****5678", "Cash on Hand" |
| **Category** | Chart of Accounts classification - what the transaction was for | "Professional Services", "Rent", "Office Supplies" |

### 2.2 Key Principle

Every transaction has:
1. **Account** (required): The bank account, credit card, or cash account
2. **Category** (required): The expense/income account from Chart of Accounts
3. **Amount**: Positive = money in, Negative = money out

### 2.3 Schema Changes Required

#### Option A: Rename Columns (Recommended - Minimal Changes)

Rename `transactions.account_id` to `transactions.category_id` to clarify its purpose:

```sql
-- Add new column
ALTER TABLE transactions ADD COLUMN category_id INTEGER REFERENCES accounts(id);

-- Migrate data
UPDATE transactions SET category_id = account_id;

-- Make category_id NOT NULL after migration
-- Drop old account_id or keep for backward compatibility
```

#### Option B: Full Separation (More Complex)

Create separate tables for Bank Accounts (COA Assets) and Categories (COA expense/income).

**Recommendation:** Use Option A - it achieves clarity without massive refactoring.

### 2.4 Required Schema Updates

#### 1. Transactions Table
```sql
-- Add category_id (the COA classification)
ALTER TABLE transactions ADD COLUMN category_id INTEGER REFERENCES accounts(id);

-- Rename/Migrate account_id usage
-- After migration: account_id = bank account (COA asset), category_id = expense/income
```

#### 2. Document Transactions Table (Staging)
```sql
ALTER TABLE document_transactions ADD COLUMN category_id INTEGER REFERENCES accounts(id);
```

#### 3. Bank Accounts Table (Add COA Link)
```sql
-- Ensure every bank_account has a corresponding COA Asset account
-- The ledger_account_id already exists - ensure it's always populated
```

---

## 3. Detailed Implementation Plan

### Phase 1: Database Schema Updates

#### Step 1.1: Add category_id to transactions
```sql
-- Migration 1: Add category_id column
ALTER TABLE transactions ADD COLUMN category_id INTEGER REFERENCES accounts(id);

-- Migration 2: Copy account_id to category_id for existing data
UPDATE transactions SET category_id = account_id;

-- Migration 3: Make category_id NOT NULL for new transactions
-- (Keep account_id for now - will repurpose as bank_account reference)
```

#### Step 1.2: Update document_transactions table
```sql
ALTER TABLE document_transactions ADD COLUMN category_id INTEGER REFERENCES accounts(id);
UPDATE document_transactions SET category_id = suggested_account_id;
```

#### Step 1.3: Ensure bank_accounts have COA Asset links
```sql
-- Update ensure_bank_ledger_account function to always create/link Asset account
-- Every bank_account MUST have a ledger_account_id pointing to accounts(type='asset')
```

### Phase 2: Data Model Updates (models.py)

#### Step 2.1: Update Transaction Models
```python
class TransactionCreate(BaseModel):
    category_id: int      # Renamed from account_id - COA category (expense/income)
    bank_account_id: int  # Now required - source account (COA asset)
    vendor_name: Optional[str] = None
    txn_date: str
    description: Optional[str] = None
    memo: Optional[str] = None
    amount: float
    source: str = "manual"

class TransactionOut(BaseModel):
    id: int
    category_id: int                 # COA category ID
    category_name: str = ""          # COA category name
    category_type: str = ""          # expense/income/asset/liability
    bank_account_id: int             # COA Asset account ID (was just bank reference)
    bank_account_name: str = ""      # Display name
    vendor_id: Optional[int]
    vendor_name: Optional[str]
    txn_date: str
    description: Optional[str]
    memo: Optional[str]
    amount: float
    is_posted: bool
    source: str
    source_doc_id: Optional[int] = None
    created_at: str
    updated_at: str
```

#### Step 2.2: Update Document Transaction Models
```python
class DocTransactionOut(BaseModel):
    id: int
    document_id: int
    txn_date: Optional[str]
    description: Optional[str]
    amount: Optional[float]
    vendor_name: Optional[str]
    suggested_category_id: Optional[int]      # Renamed from suggested_account_id
    suggested_category_name: Optional[str] = None
    confidence: float
    status: str
    user_category_id: Optional[int]           # Renamed from user_account_id
    user_category_name: Optional[str] = None
    is_duplicate: bool = False
    duplicate_of_txn_id: Optional[int] = None
    bank_account_id: Optional[int]
    bank_account_name: Optional[str] = None
```

### Phase 3: Data Service Updates (data_service.py)

#### Step 3.1: Update create_transaction()
```python
def create_transaction(conn: sqlite3.Connection, company_id: int,
                       category_id: int,                    # Required: COA category
                       txn_date: str, amount: float,
                       bank_account_id: int,                # Required: source account
                       description: str = "", memo: str = "",
                       vendor_name: str = "", source: str = "manual",
                       source_doc_id: Optional[int] = None) -> int:
    """
    Create a transaction with proper Account/Category separation.
    
    Args:
        category_id: The Chart of Accounts category (expense/income account)
        bank_account_id: The source bank account (from bank_accounts table)
    """
    # Validate category is expense/income type
    # Get linked COA Asset account from bank_account
    # Create transaction with both references
```

#### Step 3.2: Update list_transactions() query
```sql
SELECT 
    t.*, 
    c.name AS category_name,           -- COA category
    c.type AS category_type,
    ba.bank_name AS bank_account_name, -- Source account
    COA.name AS bank_coa_name,         -- COA Asset account name
    v.name AS vendor_name
FROM transactions t
JOIN accounts c ON t.category_id = c.id        -- Category join
LEFT JOIN bank_accounts ba ON t.bank_account_id = ba.id
LEFT JOIN accounts COA ON ba.ledger_account_id = COA.id  -- Bank's COA account
LEFT JOIN vendors v ON t.vendor_id = v.id
WHERE t.company_id = ?
ORDER BY t.txn_date DESC, t.id DESC
```

### Phase 4: API Endpoint Updates (transactions.py, documents.py)

#### Step 4.1: Update transactions.py router
```python
@router.post("", response_model=TransactionOut, status_code=201)
def create_transaction(body: TransactionCreate):
    # Validate bank_account_id belongs to company
    # Validate category_id is expense or income type
    tid = ds.create_transaction(
        get_conn(), get_company_id(),
        category_id=body.category_id,           # COA category
        bank_account_id=body.bank_account_id,   # Source account
        txn_date=body.txn_date,
        amount=body.amount,
        description=body.description or "",
        memo=body.memo or "",
        vendor_name=body.vendor_name or "",
        source=body.source,
    )
```

#### Step 4.2: Update documents.py import flow
```python
# When approving a document transaction:
@router.post("/transactions/{dt_id}/action")
def action_doc_transaction(dt_id: int, body: DocTransactionAction):
    if body.action == "approve":
        category_id = body.category_id or dt.get("suggested_category_id")
        
        ds.create_transaction(
            conn, cid,
            category_id=category_id,           # The COA category
            bank_account_id=dt["bank_account_id"],  # Source from statement
            txn_date=dt["txn_date"],
            amount=dt["amount"],
            description=dt["description"],
            vendor_name=dt["vendor_name"],
            source="pdf_import",
            source_doc_id=dt["document_id"],
        )
```

### Phase 5: Frontend Component Updates

#### Step 5.1: Update Transactions.jsx Table
```jsx
// Table headers - match WaveApps terminology
<th className="py-3 px-3 text-left">Date</th>
<th className="py-3 px-3 text-left">Vendor</th>
<th className="py-3 px-3 text-left">Description</th>
<th className="py-3 px-3 text-left">Account</th>    {/* Source account */}
<th className="py-3 px-3 text-left">Category</th>  {/* COA category */}
<th className="py-3 px-3 text-right">Amount</th>

// Data display
<td>{txn.bank_account_name || 'Uncategorized'}</td>
<td>
  <span className={`badge-${txn.category_type}`}>
    {txn.category_name}
  </span>
</td>
```

#### Step 5.2: Update Transaction Form
```jsx
// Add form - now requires both Account and Category
<div>
  <label className="label">Account *</label>
  <BankAccountSelect
    bankAccounts={bankAccounts}
    value={form.bank_account_id}
    onChange={e => setForm({...form, bank_account_id: e.target.value})}
    placeholder="Select bank account..."
    required
  />
</div>
<div>
  <label className="label">Category *</label>
  <GroupedAccountSelect
    accounts={accounts}
    value={form.category_id}
    onChange={e => setForm({...form, category_id: e.target.value})}
    placeholder="Select category..."
    required
  />
</div>
```

#### Step 5.3: Update Inbox.jsx
```jsx
// Show bank account info in inbox preview
<td className="py-2 px-3">
  <span className="text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
    {dt.bank_account_name || 'Unknown Account'}
  </span>
</td>
<td className="py-2 px-3">
  <GroupedAccountSelect
    accounts={accounts}
    value={overrides[dt.id] || dt.suggested_category_id || ''}
    onChange={(e) => setOverrides({...overrides, [dt.id]: parseInt(e.target.value)})}
    placeholder="Select category..."
  />
</td>
```

#### Step 5.4: Create BankAccountSelect Component
```jsx
// New component for selecting bank accounts
export default function BankAccountSelect({
  bankAccounts = [],
  value = '',
  onChange,
  placeholder = 'Select account...',
  required = false,
}) {
  return (
    <select value={value} onChange={onChange} required={required} className="input-field">
      <option value="">{placeholder}</option>
      {bankAccounts.map(ba => (
        <option key={ba.id} value={ba.id}>
          {ba.bank_name} ****{ba.last_four} {ba.nickname ? `(${ba.nickname})` : ''}
        </option>
      ))}
    </select>
  );
}
```

### Phase 6: Seed Data Updates

#### Step 6.1: Update seed_data.py
```python
def seed_demo_data(conn: sqlite3.Connection, company_id: int) -> None:
    # Create bank accounts with COA links
    chase_bank_id = upsert_bank_account(
        conn, company_id,
        bank_name="Chase",
        last_four="1234",
        ledger_account_id=account_map["Chase Business Checking"]  # COA Asset
    )
    
    # Create transactions with BOTH category and account
    for category, vendor_list in vendors_by_category.items():
        category_id = account_map.get(category)  # COA category
        
        for vendor_name, base_amount in vendor_list:
            # 80% from Chase, 20% from other accounts
            bank_id = chase_bank_id if random.random() > 0.2 else other_bank_id
            
            create_transaction(
                conn, company_id,
                category_id=category_id,      # COA category
                bank_account_id=bank_id,      # Source account
                txn_date=txn_date,
                amount=actual_amount,
                description=description,
                vendor_name=vendor_name,
            )
```

### Phase 7: Migration Strategy

#### Step 7.1: Database Migration Script
```python
# migration_script.py
"""
Migrate existing data to new schema:
1. Add category_id column to transactions
2. Copy account_id values to category_id
3. For each transaction with bank_account_id, ensure bank_account has COA Asset link
4. Update any transactions without bank_account_id to use a default "Unknown Account"
"""

def migrate_transactions(conn):
    # Add category_id column
    conn.execute("ALTER TABLE transactions ADD COLUMN category_id INTEGER REFERENCES accounts(id)")
    
    # Copy account_id to category_id
    conn.execute("UPDATE transactions SET category_id = account_id")
    
    # Create default "Unknown Account" for transactions without bank_account_id
    cursor = conn.execute(
        """INSERT INTO accounts (company_id, name, type, is_active, created_at, updated_at)
           SELECT DISTINCT company_id, 'Unknown Account', 'asset', 1, ?, ?
           FROM transactions WHERE bank_account_id IS NULL""",
        (now, now)
    )
    
    # Create bank_account records for unknown accounts
    # Link transactions to these default accounts
    
    conn.commit()
```

---

## 4. Summary of Changes

### Files to Modify

| File | Changes |
|------|---------|
| `backend/app/database.py` | Add migration for category_id column |
| `backend/app/models.py` | Update Transaction* and DocTransaction* models |
| `backend/app/services/data_service.py` | Update create_transaction(), list_transactions() queries |
| `backend/app/routers/transactions.py` | Update endpoints to use category_id and bank_account_id |
| `backend/app/routers/documents.py` | Update import flow to set both fields |
| `backend/app/services/seed_data.py` | Update demo data creation |
| `frontend/src/pages/Transactions.jsx` | Update table columns and form |
| `frontend/src/pages/Inbox.jsx` | Show bank account, update category select |
| `frontend/src/api/client.js` | Update API calls if needed |
| `frontend/src/components/BankAccountSelect.jsx` | New component |

### API Changes

| Endpoint | Change |
|----------|--------|
| `POST /api/transactions` | Now requires `category_id` (COA) and `bank_account_id` (source) |
| `PUT /api/transactions/{id}` | Accepts `category_id` and `bank_account_id` |
| `POST /api/documents/transactions/{id}/action` | Uses `category_id` for COA, `bank_account_id` from doc |
| All transaction list endpoints | Return `category_name`, `category_type`, `bank_account_name` |

### Data Flow After Changes

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Bank Statement │────▶│  PDF Parser      │────▶│  bank_accounts  │
│  (PDF Upload)   │     │  (Detect Bank)   │     │  (Source Info)  │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Transaction    │◀────│  User Approves   │◀────│  document_trans │
│  (Posted)       │     │  (Inbox)         │     │  (Staging)      │
└────────┬────────┘     └──────────────────┘     └─────────────────┘
         │
         │  Creates:
         │  - category_id → accounts (expense/income)
         │  - bank_account_id → bank_accounts → accounts (asset)
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      transactions table                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ category_id │  │bank_account_│  │  amount, date, desc...  │  │
│  │  (COA Cat)  │  │    id       │  │                         │  │
│  └──────┬──────┘  └──────┬──────┘  └─────────────────────────┘  │
│         │                │                                       │
│         ▼                ▼                                       │
│  ┌─────────────┐  ┌─────────────┐                                │
│  │   accounts  │  │bank_accounts│                                │
│  │ (expense/   │  │  (metadata) │                                │
│  │  income)    │  └──────┬──────┘                                │
│  └─────────────┘         │                                       │
│                          ▼                                       │
│                   ┌─────────────┐                                │
│                   │   accounts  │                                │
│                   │  (asset)    │                                │
│                   └─────────────┘                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Demo Data Structure

After implementation, demo data should show:

| Date | Vendor | Description | Account | Category | Amount |
|------|--------|-------------|---------|----------|--------|
| 2026-01-15 | Staples | Office supplies | Chase ****1234 | Office Supplies | -$45.00 |
| 2026-01-14 | Acme Corp | Invoice payment | Chase ****1234 | Sales Revenue | $2,500.00 |
| 2026-01-13 | Uber | Airport ride | Corporate Card ****5678 | Travel | -$28.00 |

This clearly separates:
- **Account**: Which bank/card was used
- **Category**: What the transaction was for (COA classification)

---

## 6. Next Steps

1. **Review this design** - Confirm approach and any modifications needed
2. **Approve migration strategy** - Decide on backward compatibility requirements
3. **Switch to Code mode** - Implement the changes in the planned phases
4. **Test with demo data** - Verify both Account and Category columns populate correctly
