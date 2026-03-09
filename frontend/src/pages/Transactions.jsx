import { useEffect, useState } from 'react';
import { getTransactions, getAccounts, createTransaction, deleteTransaction, bulkRecategorize } from '../api/client';
import { Plus, Search, Trash2, X, Check, Tags, Filter } from 'lucide-react';

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

  const load = async () => {
    setLoading(true);
    try {
      const [txns, accts] = await Promise.all([getTransactions(filters), getAccounts()]);
      setTransactions(txns);
      setAccounts(accts);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const applyFilters = () => load();

  const handleSubmit = async (e) => {
    e.preventDefault();
    await createTransaction({ ...form, amount: parseFloat(form.amount), account_id: parseInt(form.account_id) });
    setForm({ txn_date: new Date().toISOString().slice(0, 10), vendor_name: '', description: '', amount: '', account_id: '' });
    setShowForm(false);
    load();
  };

  const handleDelete = async (id) => {
    if (confirm('Delete this transaction?')) {
      await deleteTransaction(id);
      load();
    }
  };

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transactions</h1>
          <p className="text-gray-500 mt-1">{transactions.length} transactions</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">
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
              <input value={filters.search} onChange={e => setFilters({...filters, search: e.target.value})} className="input-field pl-10" placeholder="Search vendor, description..." />
            </div>
          </div>
          <div>
            <label className="label">Account</label>
            <select value={filters.account_id} onChange={e => setFilters({...filters, account_id: e.target.value})} className="input-field">
              <option value="">All accounts</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
            </select>
          </div>
          <div>
            <label className="label">From</label>
            <input type="date" value={filters.date_from} onChange={e => setFilters({...filters, date_from: e.target.value})} className="input-field" />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" value={filters.date_to} onChange={e => setFilters({...filters, date_to: e.target.value})} className="input-field" />
          </div>
          <button onClick={applyFilters} className="btn-primary"><Filter className="w-4 h-4 mr-1" /> Filter</button>
        </div>
      </div>

      {/* Add Form */}
      {showForm && (
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">New Transaction</h3>
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
              <select value={form.account_id} onChange={e => setForm({...form, account_id: e.target.value})} required className="input-field">
                <option value="">Select...</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
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
            <select value={bulkAccount} onChange={e => setBulkAccount(e.target.value)} className="input-field w-auto">
              <option value="">Recategorize to...</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
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
                <th className="py-3 px-4 text-left">
                  <input type="checkbox" checked={selected.size === transactions.length && transactions.length > 0} onChange={toggleAll} className="rounded text-primary-600" />
                </th>
                <th className="py-3 px-4 text-left text-gray-500 font-medium">Date</th>
                <th className="py-3 px-4 text-left text-gray-500 font-medium">Vendor</th>
                <th className="py-3 px-4 text-left text-gray-500 font-medium">Description</th>
                <th className="py-3 px-4 text-left text-gray-500 font-medium">Category</th>
                <th className="py-3 px-4 text-right text-gray-500 font-medium">Amount</th>
                <th className="py-3 px-4 text-right text-gray-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map(txn => (
                <tr key={txn.id} className={`border-b border-gray-100 hover:bg-gray-50 ${selected.has(txn.id) ? 'bg-primary-50' : ''}`}>
                  <td className="py-3 px-4">
                    <input type="checkbox" checked={selected.has(txn.id)} onChange={() => toggleSelect(txn.id)} className="rounded text-primary-600" />
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">{txn.txn_date}</td>
                  <td className="py-3 px-4 font-medium">{txn.vendor_name || '-'}</td>
                  <td className="py-3 px-4 text-gray-500 max-w-xs truncate">{txn.description || '-'}</td>
                  <td className="py-3 px-4">
                    <span className={`badge-${txn.account_type}`}>{txn.account_name}</span>
                  </td>
                  <td className={`py-3 px-4 text-right font-medium whitespace-nowrap ${txn.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatMoney(txn.amount)}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button onClick={() => handleDelete(txn.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500" title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading && <div className="p-8 text-center text-gray-400">Loading...</div>}
        {!loading && transactions.length === 0 && <div className="p-8 text-center text-gray-400">No transactions found</div>}
      </div>
    </div>
  );
}
