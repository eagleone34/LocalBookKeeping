import { useEffect, useState } from 'react';
import {
  getAccounts, createAccount, updateAccount, archiveAccount,
  restoreAccount, deleteAccount, getAccountTransactionCount,
} from '../api/client';
import { Plus, Archive, RotateCcw, Edit2, X, Check, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import GroupedAccountSelect from '../components/GroupedAccountSelect';

const TYPES = ['income', 'expense', 'asset', 'liability'];
const TYPE_COLORS = { income: 'badge-income', expense: 'badge-expense', asset: 'badge-asset', liability: 'badge-liability' };

export default function Accounts() {
  const [accounts, setAccounts] = useState([]);
  const [showInactive, setShowInactive] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [newForm, setNewForm] = useState({ name: '', type: 'expense', code: '', description: '', parent_id: null });
  const [collapsedTypes, setCollapsedTypes] = useState(new Set());
  const [deleteError, setDeleteError] = useState(null);

  const load = () => getAccounts(showInactive).then(setAccounts).catch(console.error);
  useEffect(() => { load(); }, [showInactive]);

  // ─── Create new account ───
  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    await createAccount(newForm);
    setNewForm({ name: '', type: 'expense', code: '', description: '', parent_id: null });
    setShowNewForm(false);
    load();
  };

  // ─── Start inline editing ───
  const startEdit = (acc) => {
    setEditId(acc.id);
    setEditForm({
      name: acc.name,
      type: acc.type,
      code: acc.code || '',
      description: acc.description || '',
      parent_id: acc.parent_id,
    });
    setDeleteError(null);
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditForm({});
    setDeleteError(null);
  };

  const saveEdit = async () => {
    await updateAccount(editId, editForm);
    setEditId(null);
    setEditForm({});
    load();
  };

  // ─── Delete with transaction check ───
  const handleDelete = async (acc) => {
    setDeleteError(null);
    try {
      const { count } = await getAccountTransactionCount(acc.id);
      if (count > 0) {
        setDeleteError(`Cannot delete "${acc.name}": it has ${count} transaction(s). Re-categorize them first or archive the account.`);
        return;
      }
      if (!confirm(`Delete account "${acc.name}" permanently? This cannot be undone.`)) return;
      await deleteAccount(acc.id);
      load();
    } catch (err) {
      setDeleteError(err.message || 'Failed to delete account');
    }
  };

  // ─── Collapse/expand type groups ───
  const toggleType = (type) => {
    const next = new Set(collapsedTypes);
    next.has(type) ? next.delete(type) : next.add(type);
    setCollapsedTypes(next);
  };

  const grouped = TYPES.map(type => ({
    type,
    label: type.charAt(0).toUpperCase() + type.slice(1),
    items: accounts.filter(a => a.type === type),
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
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
          <button onClick={() => { setShowNewForm(true); setEditId(null); setDeleteError(null); }} className="btn-primary">
            <Plus className="w-4 h-4 mr-2" /> New Account
          </button>
        </div>
      </div>

      {/* Error banner */}
      {deleteError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center justify-between">
          <span className="text-sm">{deleteError}</span>
          <button onClick={() => setDeleteError(null)} className="text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* New Account Form (top-level, only for creating) */}
      {showNewForm && (
        <div className="card border-2 border-primary-200 bg-primary-50/30">
          <h3 className="text-lg font-semibold mb-4 text-primary-700">New Account</h3>
          <form onSubmit={handleCreateSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="label">Name *</label>
              <input value={newForm.name} onChange={e => setNewForm({...newForm, name: e.target.value})} required className="input-field" placeholder="e.g., Office Supplies" />
            </div>
            <div>
              <label className="label">Type *</label>
              <select value={newForm.type} onChange={e => setNewForm({...newForm, type: e.target.value})} className="input-field">
                {TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Code</label>
              <input value={newForm.code} onChange={e => setNewForm({...newForm, code: e.target.value})} className="input-field" placeholder="e.g., 5200" />
            </div>
            <div>
              <label className="label">Parent</label>
              <GroupedAccountSelect
                accounts={accounts.filter(a => a.is_active)}
                value={newForm.parent_id || ''}
                onChange={e => setNewForm({...newForm, parent_id: e.target.value ? parseInt(e.target.value) : null})}
                placeholder="None (top level)"
                showCode
              />
            </div>
            <div className="flex items-end gap-2">
              <button type="submit" className="btn-primary"><Check className="w-4 h-4 mr-1" /> Create</button>
              <button type="button" onClick={() => setShowNewForm(false)} className="btn-secondary"><X className="w-4 h-4 mr-1" /> Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Accounts grouped by type */}
      {grouped.map(({ type, label, items }) => {
        const isCollapsed = collapsedTypes.has(type);
        return (
          <div key={type} className="card">
            <div
              className="flex items-center justify-between mb-2 cursor-pointer select-none"
              onClick={() => toggleType(type)}
            >
              <h3 className="text-lg font-semibold flex items-center gap-2">
                {isCollapsed
                  ? <ChevronRight className="w-5 h-5 text-gray-400" />
                  : <ChevronDown className="w-5 h-5 text-gray-400" />
                }
                <span className={TYPE_COLORS[type]}>{label}</span>
                <span className="text-gray-400 text-sm font-normal">({items.length} accounts)</span>
              </h3>
            </div>

            {!isCollapsed && (
              <>
                {items.length === 0 ? (
                  <p className="text-gray-400 text-sm ml-7">No {label.toLowerCase()} accounts yet</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 px-2 text-gray-500 font-medium w-20">Code</th>
                        <th className="text-left py-2 px-2 text-gray-500 font-medium">Name</th>
                        <th className="text-left py-2 px-2 text-gray-500 font-medium">Description</th>
                        <th className="text-left py-2 px-2 text-gray-500 font-medium w-24">Status</th>
                        <th className="text-right py-2 px-2 text-gray-500 font-medium w-36">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(acc => (
                        editId === acc.id ? (
                          /* ═══ INLINE EDIT ROW ═══ */
                          <tr key={acc.id} className="border-b border-primary-100 bg-primary-50/40">
                            <td className="py-2 px-2">
                              <input
                                value={editForm.code}
                                onChange={e => setEditForm({...editForm, code: e.target.value})}
                                className="input-field text-sm py-1"
                                placeholder="Code"
                              />
                            </td>
                            <td className="py-2 px-2">
                              <input
                                value={editForm.name}
                                onChange={e => setEditForm({...editForm, name: e.target.value})}
                                className="input-field text-sm py-1"
                                placeholder="Account name"
                                required
                              />
                            </td>
                            <td className="py-2 px-2">
                              <input
                                value={editForm.description}
                                onChange={e => setEditForm({...editForm, description: e.target.value})}
                                className="input-field text-sm py-1"
                                placeholder="Description"
                              />
                            </td>
                            <td className="py-2 px-2">
                              <select
                                value={editForm.type}
                                onChange={e => setEditForm({...editForm, type: e.target.value})}
                                className="input-field text-xs py-1"
                              >
                                {TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                              </select>
                            </td>
                            <td className="py-2 px-2 text-right">
                              <div className="flex justify-end gap-1">
                                <button
                                  onClick={saveEdit}
                                  className="p-1.5 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700"
                                  title="Save"
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={cancelEdit}
                                  className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500"
                                  title="Cancel"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          /* ═══ NORMAL DISPLAY ROW ═══ */
                          <tr key={acc.id} className={`border-b border-gray-100 hover:bg-gray-50 ${!acc.is_active ? 'opacity-50' : ''}`}>
                            <td className="py-2 px-2 text-gray-400 font-mono text-xs">{acc.code || '-'}</td>
                            <td className="py-2 px-2 font-medium">
                              {acc.parent_id ? <span className="text-gray-300 mr-1">└</span> : ''}
                              {acc.name}
                            </td>
                            <td className="py-2 px-2 text-gray-500 max-w-xs truncate">{acc.description || '-'}</td>
                            <td className="py-2 px-2">
                              {acc.is_active
                                ? <span className="badge bg-emerald-100 text-emerald-700">Active</span>
                                : <span className="badge bg-gray-100 text-gray-500">Archived</span>
                              }
                            </td>
                            <td className="py-2 px-2 text-right">
                              <div className="flex justify-end gap-1">
                                <button
                                  onClick={() => startEdit(acc)}
                                  className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600"
                                  title="Edit inline"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                {acc.is_active ? (
                                  <button
                                    onClick={async () => { await archiveAccount(acc.id); load(); }}
                                    className="p-1.5 rounded-lg hover:bg-amber-50 text-gray-400 hover:text-amber-600"
                                    title="Archive"
                                  >
                                    <Archive className="w-4 h-4" />
                                  </button>
                                ) : (
                                  <button
                                    onClick={async () => { await restoreAccount(acc.id); load(); }}
                                    className="p-1.5 rounded-lg hover:bg-emerald-50 text-gray-400 hover:text-emerald-600"
                                    title="Restore"
                                  >
                                    <RotateCcw className="w-4 h-4" />
                                  </button>
                                )}
                                <button
                                  onClick={() => handleDelete(acc)}
                                  className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500"
                                  title="Delete (only if no transactions)"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
