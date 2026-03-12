import { useEffect, useState, useCallback, useMemo } from 'react';
import { getBudgets, getAccounts, upsertBudget, deleteBudget, getBudgetVsActual } from '../api/client';
import { Plus, Trash2, Check, X, TrendingUp, TrendingDown, Minus, Pencil, BarChart2, Activity } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell, ReferenceLine,
} from 'recharts';
import GroupedAccountSelect from '../components/GroupedAccountSelect';

function formatMoney(val) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(val);
}

// ── Period helpers ────────────────────────────────────────
function toMonth(d) { return d.toISOString().slice(0, 7); }  // "YYYY-MM"

function getPresetRange(preset) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-indexed

  switch (preset) {
    case 'this_month':
      return { from: toMonth(new Date(y, m, 1)), to: toMonth(new Date(y, m, 1)) };
    case 'last_3_months': {
      const start = new Date(y, m - 2, 1);
      return { from: toMonth(start), to: toMonth(new Date(y, m, 1)) };
    }
    case 'this_year':
      return { from: `${y}-01`, to: toMonth(new Date(y, m, 1)) };
    case 'last_year':
      return { from: `${y - 1}-01`, to: `${y - 1}-12` };
    case 'all':
    default:
      return { from: null, to: null };
  }
}

const PRESETS = [
  { id: 'all',          label: 'All Time' },
  { id: 'this_month',   label: 'This Month' },
  { id: 'last_3_months',label: 'Last 3 Months' },
  { id: 'this_year',    label: 'This Year' },
  { id: 'last_year',    label: 'Last Year' },
  { id: 'custom',       label: 'Custom' },
];

const CHART_VIEWS = [
  { id: 'budget_actual', label: 'Budget vs Actual', icon: BarChart2 },
  { id: 'variance',      label: 'Variance Only',    icon: Activity },
];

export default function Budgets() {
  const [budgets, setBudgets]   = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [bva, setBva]           = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [chartView, setChartView] = useState('budget_actual');

  // Period selection
  const [preset, setPreset]       = useState('this_year');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]     = useState('');

  // Account filter
  const [selectedAccount, setSelectedAccount] = useState('');

  // Budget form
  const [form, setForm] = useState({ account_id: '', month: new Date().toISOString().slice(0, 7), amount: '', notes: '' });

  // Inline editing
  const [editingKey, setEditingKey] = useState(null);
  const [editAmount, setEditAmount] = useState('');

  // Resolve date range from current preset
  const { from: monthFrom, to: monthTo } = useMemo(() => {
    if (preset === 'custom') return { from: customFrom || null, to: customTo || null };
    return getPresetRange(preset);
  }, [preset, customFrom, customTo]);

  const load = useCallback(async () => {
    try {
      const [b, a, bvaData] = await Promise.all([
        getBudgets(),
        getAccounts(),
        getBudgetVsActual(monthFrom, monthTo, selectedAccount ? parseInt(selectedAccount) : undefined),
      ]);
      setBudgets(b);
      setAccounts(a);
      setBva(bvaData);
    } catch (e) { console.error(e); }
  }, [monthFrom, monthTo, selectedAccount]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    await upsertBudget({ account_id: parseInt(form.account_id), month: form.month, amount: parseFloat(form.amount), notes: form.notes });
    setForm({ account_id: '', month: form.month, amount: '', notes: '' });
    setShowForm(false);
    load();
  };

  const handleDelete = async (id) => {
    if (confirm('Delete this budget entry?')) { await deleteBudget(id); load(); }
  };

  const startEdit = (row, budget) => {
    setEditingKey(`${row.account_id}`);
    setEditAmount(String(budget ? budget.amount : row.budgeted));
  };
  const cancelEdit = () => { setEditingKey(null); setEditAmount(''); };
  const saveEdit = async (row) => {
    // upsert for each month that has a budget in range — simplest: find the most recent budget for this account
    const acctBudgets = budgets.filter(b => b.account_id === row.account_id);
    if (acctBudgets.length === 0) return;
    // Update only the month matching the current form default, or the most recent one
    const target = acctBudgets[acctBudgets.length - 1];
    await upsertBudget({ account_id: row.account_id, month: target.month, amount: parseFloat(editAmount), notes: target.notes });
    cancelEdit();
    load();
  };

  const expenseAccounts = accounts.filter(a => a.type === 'expense');

  // Chart data
  const budgetActualData = bva.map(row => ({
    name: row.account_name.length > 14 ? row.account_name.slice(0, 14) + '…' : row.account_name,
    Budget: row.budgeted,
    Actual: row.actual,
  }));
  const varianceData = bva.map(row => ({
    name: row.account_name.length > 14 ? row.account_name.slice(0, 14) + '…' : row.account_name,
    Variance: row.variance,
    over: row.variance < 0,
  }));

  const periodLabel = PRESETS.find(p => p.id === preset)?.label ?? 'Custom';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Budgets</h1>
          <p className="text-gray-500 mt-1">Set monthly budgets and track actual spending</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">
          <Plus className="w-4 h-4 mr-2" /> Set Budget
        </button>
      </div>

      {/* Filter Bar */}
      <div className="card py-3 px-4 space-y-3">
        {/* Period presets */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gray-500 mr-1">Period:</span>
          {PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                preset === p.id
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-primary-300 hover:text-primary-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Custom date pickers */}
        {preset === 'custom' && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">From</span>
            <input type="month" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="input-field w-auto" />
            <span className="text-sm text-gray-500">To</span>
            <input type="month" value={customTo} onChange={e => setCustomTo(e.target.value)} className="input-field w-auto" />
          </div>
        )}

        {/* Account filter */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-500">Account:</span>
          <select value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)} className="input-field w-auto">
            <option value="">All accounts</option>
            {expenseAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {selectedAccount && (
            <button onClick={() => setSelectedAccount('')} className="text-xs text-gray-400 hover:text-gray-600 underline">Clear</button>
          )}
        </div>
      </div>

      {/* Add Form */}
      {showForm && (
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Set Budget</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="label">Month *</label>
              <input type="month" value={form.month} onChange={e => setForm({...form, month: e.target.value})} required className="input-field" />
            </div>
            <div>
              <label className="label">Account *</label>
              <GroupedAccountSelect
                accounts={expenseAccounts}
                value={form.account_id}
                onChange={e => setForm({...form, account_id: e.target.value})}
                placeholder="Select account..."
                required
              />
            </div>
            <div>
              <label className="label">Budget Amount *</label>
              <input type="number" step="0.01" min="0" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} required className="input-field" placeholder="500.00" />
            </div>
            <div>
              <label className="label">Notes</label>
              <input value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="input-field" placeholder="Optional notes" />
            </div>
            <div className="flex items-end gap-2">
              <button type="submit" className="btn-primary"><Check className="w-4 h-4 mr-1" /> Save</button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary"><X className="w-4 h-4" /></button>
            </div>
          </form>
        </div>
      )}

      {/* Chart */}
      {bva.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold">
                {chartView === 'budget_actual' ? 'Budget vs Actual' : 'Variance by Account'}
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">{periodLabel}</p>
            </div>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {CHART_VIEWS.map(v => {
                const Icon = v.icon;
                return (
                  <button
                    key={v.id}
                    onClick={() => setChartView(v.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      chartView === v.id ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <Icon className="w-4 h-4" />{v.label}
                  </button>
                );
              })}
            </div>
          </div>

          <ResponsiveContainer width="100%" height={Math.max(220, bva.length * 52)}>
            {chartView === 'budget_actual' ? (
              <BarChart data={budgetActualData} layout="vertical" margin={{ left: 20, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v, name) => [formatMoney(v), name]} />
                <Legend />
                <Bar dataKey="Budget" fill="#93c5fd" radius={[0,4,4,0]} name="Budget" />
                <Bar dataKey="Actual" fill="#6366f1" radius={[0,4,4,0]} name="Actual" />
              </BarChart>
            ) : (
              <BarChart data={varianceData} layout="vertical" margin={{ left: 20, right: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12 }} />
                <Tooltip formatter={v => [formatMoney(Math.abs(v)), v >= 0 ? 'Under Budget' : 'Over Budget']} />
                <ReferenceLine x={0} stroke="#6b7280" strokeWidth={1.5} />
                <Bar dataKey="Variance" radius={[0,4,4,0]}>
                  {varianceData.map((e, i) => <Cell key={i} fill={e.over ? '#ef4444' : '#10b981'} />)}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>

          {chartView === 'variance' && (
            <div className="flex gap-6 justify-center mt-2 text-xs text-gray-500">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" /> Under Budget</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-500 inline-block" /> Over Budget</span>
            </div>
          )}
        </div>
      )}

      {/* Budget Table — one row per account */}
      <div className="card overflow-hidden p-0">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <p className="text-sm font-medium text-gray-600">{periodLabel} — {bva.length} account{bva.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="py-3 px-4 text-left text-gray-500 font-medium">Account</th>
                <th className="py-3 px-4 text-right text-gray-500 font-medium">Budget</th>
                <th className="py-3 px-4 text-right text-gray-500 font-medium">Actual</th>
                <th className="py-3 px-4 text-right text-gray-500 font-medium">Variance</th>
                <th className="py-3 px-4 text-center text-gray-500 font-medium">Status</th>
                <th className="py-3 px-4 text-right text-gray-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bva.map((row, i) => {
                const pct = row.budgeted > 0 ? (row.actual / row.budgeted * 100) : 0;
                const overBudget = row.actual > row.budgeted;
                const budget = budgets.find(b => b.account_id === row.account_id);
                const isEditing = editingKey === String(row.account_id);

                return (
                  <tr key={i} className={`border-b border-gray-100 ${isEditing ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                    <td className="py-3 px-4 font-medium">{row.account_name}</td>

                    <td className="py-3 px-4 text-right">
                      {isEditing ? (
                        <input
                          type="number" step="0.01" min="0"
                          value={editAmount}
                          onChange={e => setEditAmount(e.target.value)}
                          className="w-28 text-right border border-blue-400 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                          autoFocus
                        />
                      ) : (
                        <span className="font-medium">{formatMoney(row.budgeted)}</span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right">{formatMoney(row.actual)}</td>

                    <td className={`py-3 px-4 text-right font-medium ${overBudget ? 'text-red-600' : 'text-emerald-600'}`}>
                      {isEditing
                        ? formatMoney(parseFloat(editAmount || 0) - row.actual)
                        : formatMoney(row.variance)
                      }
                    </td>

                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {overBudget ? <TrendingUp className="w-4 h-4 text-red-500" />
                          : pct > 80  ? <Minus className="w-4 h-4 text-amber-500" />
                          : <TrendingDown className="w-4 h-4 text-emerald-500" />}
                        <span className="text-xs text-gray-500">{pct.toFixed(0)}%</span>
                        <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${overBudget ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-4 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => saveEdit(row)} className="p-1.5 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200" title="Save"><Check className="w-4 h-4" /></button>
                          <button onClick={cancelEdit} className="p-1.5 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200" title="Cancel"><X className="w-4 h-4" /></button>
                        </div>
                      ) : budget ? (
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => startEdit(row, budget)} className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600" title="Edit"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => handleDelete(budget.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500" title="Delete"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {bva.length === 0 && (
          <div className="p-8 text-center text-gray-400">
            No budgets found for this period. Click "Set Budget" to add one.
          </div>
        )}
      </div>
    </div>
  );
}
