import { useEffect, useState } from 'react';
import { getAccounts, createAccount, updateAccount, archiveAccount, restoreAccount } from '../api/client';
import { Plus, Archive, RotateCcw, Edit2, X, Check } from 'lucide-react';

const TYPES = ['income', 'expense', 'asset', 'liability'];
const TYPE_COLORS = { income: 'badge-income', expense: 'badge-expense', asset: 'badge-asset', liability: 'badge-liability' };

export default function Accounts() {
  const [accounts, setAccounts] = useState([]);
  const [showInactive, setShowInactive] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: '', type: 'expense', code: '', description: '', parent_id: null });

  const load = () => getAccounts(showInactive).then(setAccounts).catch(console.error);
  useEffect(() => { load(); }, [showInactive]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (editId) {
      await updateAccount(editId, form);
    } else {
      await createAccount(form);
    }
    setForm({ name: '', type: 'expense', code: '', description: '', parent_id: null });
    setShowForm(false);
    setEditId(null);
    load();
  };

  const startEdit = (acc) => {
    setEditId(acc.id);
    setForm({ name: acc.name, type: acc.type, code: acc.code || '', description: acc.description || '', parent_id: acc.parent_id });
    setShowForm(true);
  };

  const grouped = TYPES.map(type => ({
    type,
    label: type.charAt(0).toUpperCase() + type.slice(1),
    items: accounts.filter(a => a.type === type),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Chart of Accounts</h1>
          <p className="text-gray-500 mt-1">Organize your income, expenses, assets, and liabilities</p>
        </div>
        <div className="flex gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="rounded text-primary-600" />
            Show archived
          </label>
          <button onClick={() => { setShowForm(true); setEditId(null); setForm({ name: '', type: 'expense', code: '', description: '', parent_id: null }); }} className="btn-primary">
            <Plus className="w-4 h-4 mr-2" /> New Account
          </button>
        </div>
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">{editId ? 'Edit Account' : 'New Account'}</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="label">Account Name *</label>
              <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} required className="input-field" placeholder="e.g., Office Supplies" />
            </div>
            <div>
              <label className="label">Type *</label>
              <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className="input-field">
                {TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Code</label>
              <input value={form.code} onChange={e => setForm({...form, code: e.target.value})} className="input-field" placeholder="e.g., 5200" />
            </div>
            <div>
              <label className="label">Parent Account</label>
              <select value={form.parent_id || ''} onChange={e => setForm({...form, parent_id: e.target.value ? parseInt(e.target.value) : null})} className="input-field">
                <option value="">None (top level)</option>
                {accounts.filter(a => a.is_active).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="md:col-span-2 lg:col-span-3">
              <label className="label">Description</label>
              <input value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="input-field" placeholder="Optional description" />
            </div>
            <div className="flex items-end gap-2">
              <button type="submit" className="btn-primary"><Check className="w-4 h-4 mr-1" />{editId ? 'Update' : 'Create'}</button>
              <button type="button" onClick={() => { setShowForm(false); setEditId(null); }} className="btn-secondary"><X className="w-4 h-4 mr-1" /> Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Accounts grouped by type */}
      {grouped.map(({ type, label, items }) => (
        <div key={type} className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <span className={TYPE_COLORS[type]}>{label}</span>
              <span className="text-gray-400 text-sm font-normal">({items.length} accounts)</span>
            </h3>
          </div>
          {items.length === 0 ? (
            <p className="text-gray-400 text-sm">No {label.toLowerCase()} accounts yet</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-2 text-gray-500 font-medium">Code</th>
                  <th className="text-left py-2 px-2 text-gray-500 font-medium">Name</th>
                  <th className="text-left py-2 px-2 text-gray-500 font-medium">Description</th>
                  <th className="text-left py-2 px-2 text-gray-500 font-medium">Status</th>
                  <th className="text-right py-2 px-2 text-gray-500 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map(acc => (
                  <tr key={acc.id} className={`border-b border-gray-100 hover:bg-gray-50 ${!acc.is_active ? 'opacity-50' : ''}`}>
                    <td className="py-2 px-2 text-gray-400 font-mono">{acc.code || '-'}</td>
                    <td className="py-2 px-2 font-medium">{acc.parent_id ? '  └ ' : ''}{acc.name}</td>
                    <td className="py-2 px-2 text-gray-500 max-w-xs truncate">{acc.description || '-'}</td>
                    <td className="py-2 px-2">
                      {acc.is_active
                        ? <span className="badge bg-emerald-100 text-emerald-700">Active</span>
                        : <span className="badge bg-gray-100 text-gray-500">Archived</span>
                      }
                    </td>
                    <td className="py-2 px-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => startEdit(acc)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500" title="Edit">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {acc.is_active ? (
                          <button onClick={async () => { await archiveAccount(acc.id); load(); }} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500" title="Archive">
                            <Archive className="w-4 h-4" />
                          </button>
                        ) : (
                          <button onClick={async () => { await restoreAccount(acc.id); load(); }} className="p-1.5 rounded-lg hover:bg-gray-100 text-emerald-500" title="Restore">
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}
