import { useEffect, useState, useCallback, useRef } from 'react';
import {
  getTransactions, getAccounts, createTransaction, updateTransaction,
  deleteTransaction, bulkRecategorize,
} from '../api/client';
import { Plus, Search, Trash2, X, Check, Tags, Filter, Edit2 } from 'lucide-react';
import GroupedAccountSelect from '../components/GroupedAccountSelect';

function formatMoney(val) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}

export default function Transactions() {
  const [transactions, setTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [bulkAccount, setBulkAccount] = useState('');
  const [filters, setFilters] = useState({ search: '', account_id: '', date_from: '', date_to: '' });
  const [form, setForm] = useState({ txn_date: new Date().toISOString().slice(0, 10), vendor_name: '', description: '', amount: '', account_id: '' });

  // Inline edit state
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({});

  // Use ref to avoid stale closure in debounced search
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const currentFilters = filtersRef.current;
      const [txns, accts] = await Promise.all([
        getTransactions(currentFilters),
        getAccounts(),
      ]);
      setTransactions(txns);
      setAccounts(accts);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  // Initial load
  useEffect(() => { load(); }, [load]);

  // Auto-search with debounce when filters change
  useEffect(() => {
    const timer = setTimeout(() => { load(); }, 300);
    return () => clearTimeout(timer);
  }, [filters.search, filters.account_id, filters.date_from, filters.date_to, load]);

  // ─── Create new ───
  const handleSubmit = async (e) => {
    e.preventDefault();
    await createTransaction({ ...form, amount: parseFloat(form.amount), account_id: parseInt(form.account_id) });
    setForm({ txn_date: new Date().toISOString().slice(0, 10), vendor_name: '', description: '', amount: '', account_id: '' });
    setShowForm(false);
    load();
  };

  // ─── Inline edit ───
  const startEdit = (txn) => {
    setEditId(txn.id);
    setEditForm({
      txn_date: txn.txn_date,
      vendor_name: txn.vendor_name || '',
      description: txn.description || '',
      amount: txn.amount,
      account_id: txn.account_id,
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
        account_id: parseInt(editForm.account_id),
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
    await bulkRecategorize({ transaction_ids: [...selected], account_id: parseInt(bulkAccount) });
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
    setFilters({ search: '', account_id: '', date_from: '', date_to: '' });
  };

  const hasActiveFilters = filters.search || filters.account_id || filters.date_from || filters.date_to;

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
      <div className="card">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px]">
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
          <div>
            <label className="label">Account</label>
            <GroupedAccountSelect
              accounts={accounts}
              value={filters.account_id}
              onChange={e => setFilters({...filters, account_id: e.target.value})}
              placeholder="All accounts"
            />
          </div>
          <div>
            <label className="label">From</label>
            <input type="date" value={filters.date_from} onChange={e => setFilters({...filters, date_from: e.target.value})} className="input-field" />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" value={filters.date_to} onChange={e => setFilters({...filters, date_to: e.target.value})} className="input-field" />
          </div>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="btn-secondary text-sm">
              <X className="w-4 h-4 mr-1" /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Add Form */}
      {showForm && (
        <div className="card border-2 border-primary-200 bg-primary-50/30">
          <h3 className="text-lg font-semibold mb-4 text-primary-700">New Transaction</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
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
              <input type="number" step="0.01" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} required className="input-field" placeholder="-50.00" />
            </div>
            <div>
              <label className="label">Account *</label>
              <GroupedAccountSelect
                accounts={accounts}
                value={form.account_id}
                onChange={e => setForm({...form, account_id: e.target.value})}
                placeholder="Select..."
                required
              />
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
                      <GroupedAccountSelect
                        accounts={accounts}
                        value={editForm.account_id}
                        onChange={e => setEditForm({...editForm, account_id: e.target.value})}
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
                    <td className="py-3 px-3">
                      <span className={`badge-${txn.account_type}`}>{txn.account_name}</span>
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
