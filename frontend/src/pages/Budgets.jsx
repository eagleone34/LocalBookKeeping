import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getBudgets, getAccounts, upsertBudget, deleteBudget, getBudgetVsActual } from '../api/client';
import { Plus, Trash2, Check, X, TrendingUp, TrendingDown, Minus, Pencil, BarChart2, Activity, Lock } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell, ReferenceLine,
} from 'recharts';
import GroupedAccountSelect from '../components/GroupedAccountSelect';
import DatePresetPicker from '../components/DatePresetPicker';

function formatMoney(val) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(val);
}

// Custom Y-axis tick: truncates display at 20 chars but shows full name on hover via SVG <title>
const CustomYTick = ({ x, y, payload }) => {
  const full = payload.value;
  const MAX = 20;
  const short = full.length > MAX ? full.slice(0, MAX) + '\u2026' : full;
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={4} textAnchor="end" fontSize={12} fill="#6b7280" cursor="default">
        <title>{full}</title>
        {short}
      </text>
    </g>
  );
};

/** Count the number of months between two "YYYY-MM" strings, inclusive. */
function countMonthsBetween(fromMonth, toMonth) {
  if (!fromMonth || !toMonth) return null;
  const [fy, fm] = fromMonth.split('-').map(Number);
  const [ty, tm] = toMonth.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

const CHART_VIEWS = [
  { id: 'budget_actual', label: 'Budget vs Actual', icon: BarChart2 },
  { id: 'variance',      label: 'Variance Only',    icon: Activity },
];

export default function Budgets() {
  const navigate = useNavigate();

  const [budgets, setBudgets]   = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [bva, setBva]           = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [chartView, setChartView] = useState('budget_actual');

  // Period selection (YYYY-MM-DD from DatePresetPicker)
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');

  // Account filter
  const [selectedAccount, setSelectedAccount] = useState('');

  // Budget form
  const [form, setForm] = useState({ account_id: '', month: new Date().toISOString().slice(0, 7), amount: '', notes: '' });
  
  // Current month for validation
  const currentMonth = new Date().toISOString().slice(0, 7);

  // Inline editing
  const [editingKey, setEditingKey] = useState(null);
  const [editAmount, setEditAmount] = useState('');

  // Convert YYYY-MM-DD dates from DatePresetPicker to YYYY-MM for budget API
  const monthFrom = useMemo(() => dateFrom ? dateFrom.substring(0, 7) : null, [dateFrom]);
  const monthTo   = useMemo(() => dateTo   ? dateTo.substring(0, 7)   : null, [dateTo]);

  // Number of months in the full budget period (for avg monthly budget across selected range)
  const monthsInPeriod = useMemo(() => {
    return countMonthsBetween(monthFrom, monthTo);
  }, [monthFrom, monthTo]);

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
    // Prevent setting budgets for past months
    if (form.month < currentMonth) {
      alert('Cannot set budgets for past months. Please select current month or a future month.');
      return;
    }
    await upsertBudget({ account_id: parseInt(form.account_id), month: form.month, amount: parseFloat(form.amount), notes: form.notes });
    setForm({ account_id: '', month: currentMonth, amount: '', notes: '' });
    setShowForm(false);
    load();
  };

  const handleDelete = async (id) => {
    if (confirm('Delete this budget entry?')) { await deleteBudget(id); load(); }
  };

  const startEdit = (row, budget) => {
    // Always allow editing — it targets current/future month budget
    setEditingKey(`${row.account_id}`);
    // Use the current/future budget amount if available, otherwise use the row's budgeted amount
    const acctBudgets = budgets.filter(b => b.account_id === row.account_id);
    const editableBudget = acctBudgets.find(b => b.month >= currentMonth);
    setEditAmount(String(editableBudget ? editableBudget.amount : (budget ? budget.amount : row.budgeted)));
  };
  const cancelEdit = () => { setEditingKey(null); setEditAmount(''); };
  const saveEdit = async (row) => {
    // Find the budget to update - prefer current month or future month
    const acctBudgets = budgets.filter(b => b.account_id === row.account_id);
    const editableBudget = acctBudgets.find(b => b.month >= currentMonth);
    if (editableBudget) {
      // Update existing current/future budget
      await upsertBudget({ account_id: row.account_id, month: editableBudget.month, amount: parseFloat(editAmount), notes: editableBudget.notes || '' });
    } else {
      // No current/future budget exists — create new one for the current month
      await upsertBudget({ account_id: row.account_id, month: currentMonth, amount: parseFloat(editAmount), notes: '' });
    }
    cancelEdit();
    load();
  };

  const drillDown = (accountId) => {
    const params = new URLSearchParams();
    params.set('category_id', String(accountId));
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    navigate(`/transactions?${params.toString()}`);
  };

  const expenseAccounts = accounts.filter(a => a.type === 'expense');

  // Chart data — use monthly values
  const budgetActualData = bva.map(row => ({
    name: row.account_name,
    Budget: row.monthly_budget ?? 0,
    Actual: row.monthly_actual ?? 0,
  }));
  const varianceData = bva.map(row => ({
    name: row.account_name,
    Variance: row.variance ?? 0,
    over: (row.variance ?? 0) < 0,
  }));

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
      <div className="bg-gray-50 rounded-lg p-3 space-y-3">
        {/* Category filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mr-1">Category</span>
          <select value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)} className="input-field w-auto max-w-xs">
            <option value="">All categories</option>
            {expenseAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {selectedAccount && (
            <button onClick={() => setSelectedAccount('')} className="text-xs text-gray-400 hover:text-gray-600 underline">Clear</button>
          )}
        </div>

        {/* Date period picker */}
        <DatePresetPicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateChange={(from, to) => { setDateFrom(from); setDateTo(to); }}
        />
      </div>

      {/* Add Form */}
      {showForm && (
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Set Budget</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="label">Month *</label>
              <input
                type="month"
                value={form.month}
                onChange={e => setForm({...form, month: e.target.value})}
                min={currentMonth}
                required
                className="input-field"
                title="Budgets can only be set for current month and future months"
              />
            </div>
            <div>
              <label className="label">Category *</label>
              <GroupedAccountSelect
                accounts={expenseAccounts}
                value={form.account_id}
                onChange={e => setForm({...form, account_id: e.target.value})}
                placeholder="Select category..."
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
                {chartView === 'budget_actual' ? 'Budget vs Actual' : 'Variance by Category'}
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">{monthFrom && monthTo ? `${monthFrom} – ${monthTo}` : 'All Time'}</p>
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
                <YAxis type="category" dataKey="name" width={160} tick={<CustomYTick />} />
                <Tooltip formatter={(v, name) => [formatMoney(v), name]} />
                <Legend />
                <Bar dataKey="Budget" fill="#93c5fd" radius={[0,4,4,0]} name="Budget" />
                <Bar dataKey="Actual" fill="#6366f1" radius={[0,4,4,0]} name="Actual" />
              </BarChart>
            ) : (
              <BarChart data={varianceData} layout="vertical" margin={{ left: 20, right: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" width={160} tick={<CustomYTick />} />
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
          <p className="text-sm font-medium text-gray-600">{monthFrom && monthTo ? `${monthFrom} – ${monthTo}` : 'All Time'} — {bva.length} categor{bva.length !== 1 ? 'ies' : 'y'}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="py-3 px-4 text-left text-gray-500 font-medium">Category</th>
                <th className="py-3 px-4 text-right text-gray-500 font-medium">Monthly Budget</th>
                <th className="py-3 px-4 text-right text-gray-500 font-medium">Avg Monthly Budget</th>
                <th className="py-3 px-4 text-right text-gray-500 font-medium">Monthly Actual</th>
                <th className="py-3 px-4 text-right text-gray-500 font-medium">Avg Monthly Actual</th>
                <th className="py-3 px-4 text-right text-gray-500 font-medium">Variance</th>
                <th className="py-3 px-4 text-center text-gray-500 font-medium">Status</th>
                <th className="py-3 px-4 text-right text-gray-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bva.map((row, i) => {
                const monthlyBudget = row.monthly_budget ?? 0;
                const monthlyActual = row.monthly_actual ?? 0;
                const pct = monthlyBudget > 0 ? (monthlyActual / monthlyBudget * 100) : 0;
                const overBudget = monthlyActual > monthlyBudget;
                const budget = budgets.find(b => b.account_id === row.account_id);
                const isEditing = editingKey === String(row.account_id);

                // Avg monthly budget across the entire selected period (accounts for months without a budget set)
                const avgMonthlyBudget = monthsInPeriod ? row.budgeted / monthsInPeriod : monthlyBudget;

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
                        <span className="font-medium">{formatMoney(monthlyBudget)}</span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right text-gray-500">{formatMoney(avgMonthlyBudget)}</td>

                    <td className="py-3 px-4 text-right">
                      <span
                        className="cursor-pointer text-blue-600 hover:text-blue-800 hover:underline"
                        onClick={() => drillDown(row.account_id)}
                        title="View transactions"
                      >
                        {formatMoney(monthlyActual)}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-right text-gray-500">
                      <span
                        className="cursor-pointer text-blue-600 hover:text-blue-800 hover:underline"
                        onClick={() => drillDown(row.account_id)}
                        title="View transactions"
                      >
                        {formatMoney(monthlyActual)}
                      </span>
                    </td>

                    <td className={`py-3 px-4 text-right font-medium ${overBudget ? 'text-red-600' : 'text-emerald-600'}`}>
                      {isEditing
                        ? formatMoney(parseFloat(editAmount || 0) - monthlyActual)
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
                      ) : (() => {
                        // Check if this account has ANY budget for current or future month
                        const editableBudget = budgets.find(b => b.account_id === row.account_id && b.month >= currentMonth);
                        const deletableBudget = editableBudget || budget;
                        return (
                          <div className="flex items-center justify-end gap-1">
                            {budget && !editableBudget && (
                              <Lock className="w-4 h-4 text-gray-300" title="Historical months locked" />
                            )}
                            <button onClick={() => startEdit(row, budget)} className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-600" title={editableBudget ? "Edit budget" : "Set budget for current month"}><Pencil className="w-4 h-4" /></button>
                            {deletableBudget && deletableBudget.month >= currentMonth && (
                              <button onClick={() => handleDelete(deletableBudget.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500" title="Delete"><Trash2 className="w-4 h-4" /></button>
                            )}
                          </div>
                        );
                      })()}
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
