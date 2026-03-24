import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  getTransactions, getAccounts, getBankAccounts, createTransaction, updateTransaction,
  deleteTransaction, bulkRecategorize,
} from '../api/client';
import { Plus, Search, Trash2, X, Check, Tags, Filter, Edit2, Building2 } from 'lucide-react';
import GroupedAccountSelect from '../components/GroupedAccountSelect';
import DatePresetPicker from '../components/DatePresetPicker';

function formatMoney(val) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}

export default function Transactions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [transactions, setTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [bulkAccount, setBulkAccount] = useState('');
  const [filters, setFilters] = useState({ search: '', account_id: '', category_id: '', category_type: '', bank_account_id: '', date_from: '', date_to: '' });
  const [form, setForm] = useState({
    txn_date: new Date().toISOString().slice(0, 10),
    vendor_name: '',
    description: '',
    amount: '',
    category_id: '',
    bank_account_id: ''
  });

  // Inline edit state
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({});

  // Use ref to avoid stale closure in debounced search
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // Initialize filters from URL search params on mount
  useEffect(() => {
    const paramKeys = ['search', 'account_id', 'category_id', 'category_type', 'bank_account_id', 'date_from', 'date_to'];
    const urlFilters = {};
    let hasUrlFilters = false;
    paramKeys.forEach(key => {
      const val = searchParams.get(key);
      if (val) {
        urlFilters[key] = val;
        hasUrlFilters = true;
      }
    });
    if (hasUrlFilters) {
      setFilters(prev => ({ ...prev, ...urlFilters }));
    }
  }, []); // Run once on mount

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const currentFilters = filtersRef.current;
      // Build filters for API
      const apiFilters = {};
      if (currentFilters.search) apiFilters.search = currentFilters.search;
      if (currentFilters.category_type) {
        apiFilters.category_type = currentFilters.category_type;
      } else if (currentFilters.category_id) {
        apiFilters.category_id = currentFilters.category_id;
      }
      if (currentFilters.bank_account_id) apiFilters.bank_account_id = currentFilters.bank_account_id;
      if (currentFilters.date_from) apiFilters.date_from = currentFilters.date_from;
      if (currentFilters.date_to) apiFilters.date_to = currentFilters.date_to;
      
      const [txns, accts, banks] = await Promise.all([
        getTransactions(apiFilters),
        getAccounts(),
        getBankAccounts(),
      ]);
      
      setTransactions(txns);
      setAccounts(accts);
      setBankAccounts(banks);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  // Initial load
  useEffect(() => { load(); }, [load]);

  // Auto-search with debounce when filters change
  useEffect(() => {
    const timer = setTimeout(() => { load(); }, 300);
    return () => clearTimeout(timer);
  }, [filters.search, filters.account_id, filters.category_id, filters.category_type, filters.bank_account_id, filters.date_from, filters.date_to, load]);

  // ─── Create new ───
  const handleSubmit = async (e) => {
    e.preventDefault();

    const rawAmount = parseFloat(form.amount);
    if (isNaN(rawAmount) || rawAmount === 0) {
      alert('Please enter a valid non-zero amount.');
      return;
    }

    // Auto-negate for expense categories: users always enter positive numbers,
    // and the system stores expenses as negative values automatically.
    // Income / asset / liability categories keep the amount positive (or as-entered).
    const selectedCategoryId = parseInt(form.category_id, 10);
    const selectedAccount = accounts.find(a => a.id === selectedCategoryId);
    const finalAmount = selectedAccount?.type === 'expense'
      ? -Math.abs(rawAmount)
      : Math.abs(rawAmount);

    try {
      await createTransaction({
        ...form,
        amount: finalAmount,
        category_id: selectedCategoryId,
        bank_account_id: form.bank_account_id ? parseInt(form.bank_account_id, 10) : null,
      });
      setForm({
        txn_date: new Date().toISOString().slice(0, 10),
        vendor_name: '',
        description: '',
        amount: '',
        category_id: '',
        bank_account_id: '',
      });
      setShowForm(false);
      load();
    } catch (err) {
      console.error('Failed to create transaction:', err);
      alert(`Could not save transaction: ${err.message}`);
    }
  };

  // ─── Inline edit ───
  const startEdit = (txn) => {
    setEditId(txn.id);
    setEditForm({
      txn_date: txn.txn_date,
      vendor_name: txn.vendor_name || '',
      description: txn.description || '',
      amount: txn.amount,
      category_id: txn.category_id || txn.account_id,
      bank_account_id: txn.bank_account_id || '',
    });
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditForm({});
  };

  const saveEdit = async () => {
    try {
      await updateTransaction(editId, {
        txn_date: editForm.txn_date,
        vendor_name: editForm.vendor_name,
        description: editForm.description,
        amount: parseFloat(editForm.amount),
        category_id: parseInt(editForm.category_id),
        bank_account_id: editForm.bank_account_id ? parseInt(editForm.bank_account_id) : null,
      });
      setEditId(null);
      setEditForm({});
      load();
    } catch (err) {
      console.error('Save failed', err);
    }
  };

  // Handle Enter key to save, Escape to cancel
  const handleEditKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
    if (e.key === 'Escape') { cancelEdit(); }
  };

  // ─── Delete ───
  const handleDelete = async (id) => {
    if (confirm('Delete this transaction?')) {
      await deleteTransaction(id);
      if (editId === id) cancelEdit();
      load();
    }
  };

  // ─── Bulk ───
  const handleBulkRecategorize = async () => {
    if (!bulkAccount || selected.size === 0) return;
    await bulkRecategorize({ transaction_ids: [...selected], category_id: parseInt(bulkAccount) });
    setSelected(new Set());
    setBulkAccount('');
    load();
  };

  const toggleSelect = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === transactions.length) setSelected(new Set());
    else setSelected(new Set(transactions.map(t => t.id)));
  };

  // Clear all filters
  const clearFilters = () => {
    setFilters({ search: '', account_id: '', category_id: '', category_type: '', bank_account_id: '', date_from: '', date_to: '' });
  };

  const hasActiveFilters = filters.search || filters.account_id || filters.category_id || filters.category_type || filters.bank_account_id || filters.date_from || filters.date_to;
  
  // Group categories by type for custom dropdown
  const TYPE_ORDER = ['expense', 'income', 'asset', 'liability'];
  const TYPE_LABELS = { expense: 'Expenses', income: 'Income', asset: 'Assets', liability: 'Liabilities' };
  const groupedCategories = TYPE_ORDER.map(type => ({
    type,
    label: TYPE_LABELS[type],
    items: accounts.filter(a => a.type === type && a.is_active !== false),
  })).filter(g => g.items.length > 0);
  
  // Handle category/group filter change
  const handleCategoryFilterChange = (value) => {
    if (value.startsWith('GROUP_')) {
      const groupType = value.replace('GROUP_', '').toLowerCase();
      setFilters({...filters, category_id: '', category_type: groupType});
    } else {
      setFilters({...filters, category_id: value, category_type: ''});
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transactions</h1>
          <p className="text-gray-500 mt-1">{transactions.length} transactions{hasActiveFilters ? ' (filtered)' : ''}</p>
        </div>
        <button onClick={() => { setShowForm(true); cancelEdit(); }} className="btn-primary">
          <Plus className="w-4 h-4 mr-2" /> New Transaction
        </button>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        {/* Row 1: Search, Category, Account, Clear */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="label">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={filters.search}
                onChange={e => setFilters({...filters, search: e.target.value})}
                className="input-field pl-10"
                placeholder="Search vendor, description..."
              />
            </div>
          </div>
          <div className="min-w-[160px]">
            <label className="label">Category</label>
            <select
              value={filters.category_type ? `GROUP_${filters.category_type.toUpperCase()}` : filters.category_id}
              onChange={e => handleCategoryFilterChange(e.target.value)}
              className="input-field"
            >
              <option value="">All categories</option>
              {/* Group-level filters */}
              {groupedCategories.map(({ type, label }) => (
                <option key={`group_${type}`} value={`GROUP_${type.toUpperCase()}`}>
                  ── All {label} ──
                </option>
              ))}
              {/* Individual categories grouped by type */}
              {groupedCategories.map(({ type, label, items }) => (
                <optgroup key={type} label={`── ${label} ──`}>
                  {items.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.code ? `${a.code} – ` : ''}{a.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="min-w-[160px]">
            <label className="label">Account</label>
            <select
              value={filters.bank_account_id || ''}
              onChange={e => setFilters({...filters, bank_account_id: e.target.value})}
              className="input-field"
            >
              <option value="">All accounts</option>
              {bankAccounts.map(ba => (
                <option key={ba.id} value={ba.id}>
                  {ba.bank_name} ****{ba.last_four}
                </option>
              ))}
            </select>
          </div>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="btn-secondary text-sm self-end">
              <X className="w-4 h-4 mr-1" /> Clear
            </button>
          )}
        </div>

        {/* Row 2: Period picker */}
        <DatePresetPicker
          dateFrom={filters.date_from}
          dateTo={filters.date_to}
          onDateChange={(from, to) => setFilters({...filters, date_from: from, date_to: to})}
        />
      </div>

      {/* Add Form */}
      {showForm && (
        <div className="card border-2 border-primary-200 bg-primary-50/30">
          <h3 className="text-lg font-semibold mb-4 text-primary-700">New Transaction</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-7 gap-4">
            <div>
              <label className="label">Date *</label>
              <input type="date" value={form.txn_date} onChange={e => setForm({...form, txn_date: e.target.value})} required className="input-field" />
            </div>
            <div>
              <label className="label">Vendor/Payee</label>
              <input value={form.vendor_name} onChange={e => setForm({...form, vendor_name: e.target.value})} className="input-field" placeholder="e.g., Amazon" />
            </div>
            <div>
              <label className="label">Description</label>
              <input value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="input-field" placeholder="What was this for?" />
            </div>
            <div>
              <label className="label">Amount *</label>
              <input type="number" step="0.01" min="0" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} required className="input-field" placeholder="50.00" />
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
            <div>
              <label className="label">Account *</label>
              <select
                value={form.bank_account_id}
                onChange={e => setForm({...form, bank_account_id: e.target.value})}
                required
                className="input-field"
              >
                <option value="">Select account...</option>
                {bankAccounts.map(ba => (
                  <option key={ba.id} value={ba.id}>
                    {ba.bank_name} ****{ba.last_four}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button type="submit" className="btn-primary"><Check className="w-4 h-4 mr-1" /> Save</button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary"><X className="w-4 h-4" /></button>
            </div>
          </form>
        </div>
      )}

      {/* Bulk Actions */}
      {selected.size > 0 && (
        <div className="card bg-primary-50 border-primary-200">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-primary-700">{selected.size} selected</span>
            <GroupedAccountSelect
              accounts={accounts}
              value={bulkAccount}
              onChange={e => setBulkAccount(e.target.value)}
              placeholder="Recategorize to..."
              className="input-field w-auto"
            />
            <button onClick={handleBulkRecategorize} disabled={!bulkAccount} className="btn-primary btn-sm">
              <Tags className="w-4 h-4 mr-1" /> Apply
            </button>
            <button onClick={() => setSelected(new Set())} className="btn-secondary btn-sm">Clear</button>
          </div>
        </div>
      )}

      {/* Transaction Table */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="py-3 px-3 text-left w-10">
                  <input type="checkbox" checked={selected.size === transactions.length && transactions.length > 0} onChange={toggleAll} className="rounded text-primary-600" />
                </th>
                <th className="py-3 px-3 text-left text-gray-500 font-medium w-28">Date</th>
                <th className="py-3 px-3 text-left text-gray-500 font-medium">Vendor</th>
                <th className="py-3 px-3 text-left text-gray-500 font-medium">Description</th>
                <th className="py-3 px-3 text-left text-gray-500 font-medium w-32">Account</th>
                <th className="py-3 px-3 text-left text-gray-500 font-medium w-44">Category</th>
                <th className="py-3 px-3 text-right text-gray-500 font-medium w-28">Amount</th>
                <th className="py-3 px-3 text-right text-gray-500 font-medium w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map(txn => (
                editId === txn.id ? (
                  /* INLINE EDIT ROW */
                  <tr key={txn.id} className="border-b border-primary-100 bg-primary-50/40">
                    <td className="py-2 px-3">
                      <input type="checkbox" checked={selected.has(txn.id)} onChange={() => toggleSelect(txn.id)} className="rounded text-primary-600" />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="date"
                        value={editForm.txn_date}
                        onChange={e => setEditForm({...editForm, txn_date: e.target.value})}
                        onKeyDown={handleEditKeyDown}
                        className="input-field text-sm py-1"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        value={editForm.vendor_name}
                        onChange={e => setEditForm({...editForm, vendor_name: e.target.value})}
                        onKeyDown={handleEditKeyDown}
                        className="input-field text-sm py-1"
                        placeholder="Vendor"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        value={editForm.description}
                        onChange={e => setEditForm({...editForm, description: e.target.value})}
                        onKeyDown={handleEditKeyDown}
                        className="input-field text-sm py-1"
                        placeholder="Description"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <select
                        value={editForm.bank_account_id || ''}
                        onChange={e => setEditForm({...editForm, bank_account_id: e.target.value})}
                        className="input-field text-sm py-1"
                      >
                        {bankAccounts.map(ba => (
                          <option key={ba.id} value={ba.id}>
                            {ba.bank_name} ****{ba.last_four}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <GroupedAccountSelect
                        accounts={accounts}
                        value={editForm.category_id}
                        onChange={e => setEditForm({...editForm, category_id: e.target.value})}
                        includeEmpty={false}
                        className="input-field text-sm py-1"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        step="0.01"
                        value={editForm.amount}
                        onChange={e => setEditForm({...editForm, amount: e.target.value})}
                        onKeyDown={handleEditKeyDown}
                        className="input-field text-sm py-1 text-right"
                      />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={saveEdit} className="p-1.5 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700" title="Save (Enter)">
                          <Check className="w-4 h-4" />
                        </button>
                        <button onClick={cancelEdit} className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500" title="Cancel (Esc)">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  /* NORMAL DISPLAY ROW */
                  <tr key={txn.id} className={`border-b border-gray-100 hover:bg-gray-50 ${selected.has(txn.id) ? 'bg-primary-50' : ''}`}>
                    <td className="py-3 px-3">
                      <input type="checkbox" checked={selected.has(txn.id)} onChange={() => toggleSelect(txn.id)} className="rounded text-primary-600" />
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap text-gray-700">{txn.txn_date}</td>
                    <td className="py-3 px-3 font-medium text-gray-900">{txn.vendor_name || '-'}</td>
                    <td className="py-3 px-3 text-gray-500 max-w-xs truncate">{txn.description || '-'}</td>
                    <td className="py-3 px-3 whitespace-nowrap text-gray-500 text-sm">
                      {txn.bank_account_name ? (
                        <span className="flex items-center gap-1">
                          <Building2 className="w-3 h-3" />
                          {txn.bank_account_name}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="py-3 px-3">
                      <span className={`badge-${txn.category_type || txn.account_type}`}>
                        {txn.category_name || txn.account_name}
                      </span>
                    </td>
                    <td className={`py-3 px-3 text-right font-medium whitespace-nowrap ${txn.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {formatMoney(txn.amount)}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => startEdit(txn)} className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600" title="Edit">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(txn.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500" title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
        {loading && <div className="p-8 text-center text-gray-400">Loading...</div>}
        {!loading && transactions.length === 0 && (
          <div className="p-8 text-center text-gray-400">
            {hasActiveFilters ? 'No transactions match your filters.' : 'No transactions found'}
          </div>
        )}
      </div>
    </div>
  );
}
