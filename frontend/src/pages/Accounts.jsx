import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAccounts, createAccount, updateAccount, archiveAccount,
  restoreAccount, deleteAccount, getAccountTransactionCount,
  getAllAccountBalances,
} from '../api/client';
import {
  Plus, Archive, RotateCcw, Edit2, X, Check, Trash2,
  ChevronDown, ChevronRight, ExternalLink, Scale,
} from 'lucide-react';
import GroupedAccountSelect from '../components/GroupedAccountSelect';
import { useCurrency, getHasMultiCurrency } from '../hooks/useCurrency';
import SecondaryAmount from '../components/SecondaryAmount';

const TYPES = ['income', 'expense', 'asset', 'liability'];
const TYPE_COLORS = {
  income: 'badge-income',
  expense: 'badge-expense',
  asset: 'badge-asset',
  liability: 'badge-liability',
};

export default function Accounts() {
  const { formatPrimary } = useCurrency();
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState([]);
  // balances keys are strings (JSON always serializes object keys as strings)
  // We normalize them to strings here so lookups work correctly.
  const [balances, setBalances] = useState({}); // { "account_id": balance }
  const [showInactive, setShowInactive] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [showSecondary, setShowSecondary] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [newForm, setNewForm] = useState({ name: '', type: 'expense', code: '', description: '', parent_id: null, currency: 'USD' });
  const [collapsedTypes, setCollapsedTypes] = useState(new Set());
  const [deleteError, setDeleteError] = useState(null);
  const deleteErrorRef = useRef(null);

  const hasMultiCurrency = getHasMultiCurrency(accounts);

  const load = async () => {
    try {
      const [accts, rawBals] = await Promise.all([
        getAccounts(showInactive).catch(() => []),
        getAllAccountBalances().catch(() => ({})),
      ]);
      setAccounts(accts);
      // Normalize all keys to strings so balances[String(acc.id)] always works
      const normalized = {};
      Object.entries(rawBals).forEach(([k, v]) => {
        normalized[String(k)] = v;
      });
      setBalances(normalized);
    } catch (e) {
      console.error(e);
    }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [showInactive]);

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    await createAccount(newForm);
    setNewForm({ name: '', type: 'expense', code: '', description: '', parent_id: null, currency: 'USD' });
    setShowNewForm(false);
    load();
  };

  const startEdit = async (acc) => {
    setEditId(acc.id);
    let txnCount = 0;
    if (acc.type === 'asset' || acc.type === 'liability') {
      try {
        const { count } = await getAccountTransactionCount(acc.id);
        txnCount = count;
      } catch { /* default to 0 — allow editing */ }
    }
    setEditForm({
      name: acc.name,
      type: acc.type,
      code: acc.code || '',
      description: acc.description || '',
      parent_id: acc.parent_id,
      currency: acc.currency || 'USD',
      _txnCount: txnCount,
    });
    setDeleteError(null);
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditForm({});
    setDeleteError(null);
  };

  const saveEdit = async () => {
    const { _txnCount, ...payload } = editForm;
    await updateAccount(editId, payload);
    setEditId(null);
    setEditForm({});
    load();
  };

  const handleDelete = async (acc) => {
    setDeleteError(null);
    const showError = (msg) => {
      setDeleteError(msg);
      setTimeout(() => deleteErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    };
    try {
      const { count } = await getAccountTransactionCount(acc.id);
      if (count > 0) {
        showError(`Cannot delete "${acc.name}": it has ${count} transaction(s). Re-categorize them first or archive the account.`);
        return;
      }
      if (!confirm(`Delete account "${acc.name}" permanently? This cannot be undone.`)) return;
      await deleteAccount(acc.id);
      load();
    } catch (err) {
      showError(err.message || 'Failed to delete account');
    }
  };

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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Chart of Accounts</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Organize your income, expenses, assets, and liabilities.
            Asset &amp; liability accounts show live balances — click the{' '}
            <ExternalLink className="inline w-3.5 h-3.5 text-blue-500" /> icon to view the ledger and reconcile.
          </p>
        </div>
        <div className="flex gap-3 items-center">
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="rounded text-primary-600" />
            Show archived
          </label>
          {hasMultiCurrency && (
            <button
              onClick={() => setShowSecondary(s => !s)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${showSecondary ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300' : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'}`}
            >
              {showSecondary ? 'Hide secondary currency' : 'Show secondary currency'}
            </button>
          )}
          <button onClick={() => { setShowNewForm(true); setEditId(null); setDeleteError(null); }} className="btn-primary">
            <Plus className="w-4 h-4 mr-2" /> New Account
          </button>
        </div>
      </div>

      {/* How-to hint banner */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-3 text-sm text-blue-800 dark:text-blue-300 flex items-start gap-3">
        <Scale className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold">How to use Account Ledger &amp; Reconciliation:</span>
          <ol className="list-decimal list-inside mt-1 space-y-0.5 text-blue-700 dark:text-blue-400">
            <li>Import a PDF bank statement in <strong>Statements</strong> and approve the transactions.</li>
            <li>Come back here — your <strong>Asset</strong> accounts will show a live balance.</li>
            <li>Click the <ExternalLink className="inline w-3.5 h-3.5" /> icon on any asset row to open the <strong>Account Ledger</strong> (running balance view).</li>
            <li>From the ledger, click <strong>Reconcile Account</strong> to start a bank reconciliation.</li>
          </ol>
        </div>
      </div>

      {/* Error banner */}
      {deleteError && (
        <div ref={deleteErrorRef} className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-xl flex items-center justify-between">
          <span className="text-sm">{deleteError}</span>
          <button onClick={() => setDeleteError(null)} className="text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* New Account Form */}
      {showNewForm && (
        <div className="card border-2 border-primary-200 bg-primary-50/30">
          <h3 className="text-lg font-semibold mb-4 text-primary-700">New Account</h3>
          <form onSubmit={handleCreateSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
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
              <label className="label">Currency</label>
              <select value={newForm.currency || 'USD'} onChange={e => setNewForm({...newForm, currency: e.target.value})} className="input-field">
                <option value="USD">USD</option>
                <option value="CAD">CAD</option>
              </select>
            </div>
            <div>
              <label className="label">Code (auto)</label>
              <input value={newForm.code} onChange={e => setNewForm({...newForm, code: e.target.value})} className="input-field" placeholder="Auto-generated" />
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
        const isBalanceType = type === 'asset' || type === 'liability';

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
                <span className="text-gray-400 dark:text-gray-500 text-sm font-normal">({items.length} accounts)</span>
              </h3>
              {isBalanceType && !isCollapsed && (
                <span className="text-xs text-gray-400 dark:text-gray-500 italic">
                  Click <ExternalLink className="inline w-3 h-3" /> to view ledger &amp; reconcile
                </span>
              )}
            </div>

            {!isCollapsed && (
              <>
                {items.length === 0 ? (
                  <p className="text-gray-400 dark:text-gray-500 text-sm ml-7">No {label.toLowerCase()} accounts yet</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700">
                        <th className="text-left py-2 px-2 text-gray-500 dark:text-gray-400 font-medium w-20">Code</th>
                        <th className="text-left py-2 px-2 text-gray-500 dark:text-gray-400 font-medium">Name</th>
                        <th className="text-left py-2 px-2 text-gray-500 dark:text-gray-400 font-medium">Description</th>
                        {isBalanceType && (
                          <th className="text-center py-2 px-2 text-gray-500 dark:text-gray-400 font-medium w-20">Currency</th>
                        )}
                        {isBalanceType && (
                          <th className="text-right py-2 px-2 text-gray-500 dark:text-gray-400 font-medium w-36">
                            Balance
                            <span className="block text-xs font-normal text-gray-400 dark:text-gray-500">(linked txns)</span>
                          </th>
                        )}
                        <th className="text-left py-2 px-2 text-gray-500 dark:text-gray-400 font-medium w-24">Status</th>
                        <th className="text-right py-2 px-2 text-gray-500 dark:text-gray-400 font-medium w-48">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(acc => {
                        // JSON keys are always strings — use String(acc.id) for lookup
                        const balanceKey = String(acc.id);
                        const balance = balances[balanceKey];
                        // hasBalance is true even when balance === 0 (account exists in map)
                        const hasBalance = balance !== undefined;

                        return editId === acc.id ? (
                          /* ═══ INLINE EDIT ROW ═══ */
                          <tr key={acc.id} className="border-b border-primary-100 bg-primary-50/40">
                            <td className="py-2 px-2">
                              <input
                                value={editForm.code}
                                onChange={e => setEditForm({...editForm, code: e.target.value})}
                                className="input-field text-sm py-1"
                                placeholder="Auto-generated"
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
                            {isBalanceType && (
                              <td className="py-2 px-2 text-center">
                                <select
                                  value={editForm.currency || 'USD'}
                                  onChange={e => setEditForm({...editForm, currency: e.target.value})}
                                  className="input-field text-xs py-1"
                                  disabled={editForm._txnCount > 0}
                                  title={editForm._txnCount > 0 ? `Cannot change: ${editForm._txnCount} linked transaction(s)` : ''}
                                >
                                  <option value="USD">USD</option>
                                  <option value="CAD">CAD</option>
                                </select>
                              </td>
                            )}
                            {isBalanceType && <td className="py-2 px-2" />}
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
                                <button onClick={saveEdit} className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400" title="Save">
                                  <Check className="w-4 h-4" />
                                </button>
                                <button onClick={cancelEdit} className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400" title="Cancel">
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          /* ═══ NORMAL DISPLAY ROW ═══ */
                          <tr key={acc.id} className={`border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 ${!acc.is_active ? 'opacity-50' : ''}`}>
                            <td className="py-2 px-2 text-gray-400 dark:text-gray-500 font-mono text-xs">{acc.code || '-'}</td>
                            <td className="py-2 px-2 font-medium">
                              {acc.parent_id ? <span className="text-gray-300 mr-1">└</span> : ''}
                              {acc.name}
                            </td>
                            <td className="py-2 px-2 text-gray-500 dark:text-gray-400 max-w-xs truncate">{acc.description || '-'}</td>
                            {isBalanceType && (
                              <td className="py-2 px-2 text-center text-xs font-mono text-gray-500 dark:text-gray-400">{acc.currency || 'USD'}</td>
                            )}
                            {isBalanceType && (
                              <td className="py-2 px-2 text-right">
                                {hasBalance ? (
                                  <span
                                    className={`font-semibold text-sm ${
                                      type === 'asset'
                                        ? balance >= 0 ? 'text-emerald-600' : 'text-red-600'
                                        : balance <= 0 ? 'text-amber-600' : 'text-gray-600'
                                    }`}
                                  >
                                    {formatPrimary(balance, acc.currency || 'USD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    <SecondaryAmount amount={balance} accountCurrency={acc.currency || 'USD'} show={showSecondary} />
                                  </span>
                                ) : (
                                  <span className="text-gray-300 dark:text-gray-600 text-xs italic">
                                    no linked txns
                                  </span>
                                )}
                              </td>
                            )}
                            <td className="py-2 px-2">
                              {acc.is_active
                                ? <span className="badge bg-emerald-100 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400">Active</span>
                                : <span className="badge bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">Archived</span>
                              }
                            </td>
                            <td className="py-2 px-2 text-right">
                              <div className="flex justify-end gap-1">
                                {/* Ledger drill-down — show for ALL asset/liability accounts,
                                    not just those with a balance, so users can navigate even
                                    when balance is $0 */}
                                {isBalanceType && (
                                  <button
                                    onClick={() => navigate(`/accounts/${acc.id}/ledger`)}
                                    className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-400 hover:text-blue-600"
                                    title="View ledger &amp; reconcile"
                                  >
                                    <ExternalLink className="w-4 h-4" />
                                  </button>
                                )}
                                <button
                                  onClick={() => startEdit(acc)}
                                  className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-gray-400 dark:text-gray-500 hover:text-blue-600"
                                  title="Edit inline"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                {acc.is_active ? (
                                  <button
                                    onClick={async () => { await archiveAccount(acc.id); load(); }}
                                    className="p-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 text-gray-400 dark:text-gray-500 hover:text-amber-600"
                                    title="Archive"
                                  >
                                    <Archive className="w-4 h-4" />
                                  </button>
                                ) : (
                                  <button
                                    onClick={async () => { await restoreAccount(acc.id); load(); }}
                                    className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-gray-400 dark:text-gray-500 hover:text-emerald-600"
                                    title="Restore"
                                  >
                                    <RotateCcw className="w-4 h-4" />
                                  </button>
                                )}
                                <button
                                  onClick={() => handleDelete(acc)}
                                  className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 dark:text-gray-500 hover:text-red-500"
                                  title="Delete (only if no transactions)"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
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
