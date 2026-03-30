import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getBudgets, getAccounts, upsertBudget, deleteBudget, getBudgetSummary,
} from '../api/client';
import {
  Plus, Trash2, Check, X, TrendingUp, TrendingDown, Minus,
  Pencil, BarChart2, Activity, Lock,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell, ReferenceLine,
} from 'recharts';
import GroupedAccountSelect from '../components/GroupedAccountSelect';
import DatePresetPicker from '../components/DatePresetPicker';

// ── Formatting helpers ───────────────────────────────────────────────────────

function formatMoney(val) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(val ?? 0);
}

// Custom Y-axis tick: truncates at 20 chars, shows full name in SVG <title>
const CustomYTick = ({ x, y, payload }) => {
  const full  = payload.value ?? '';
  const MAX   = 20;
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

// ── Chart view toggle ────────────────────────────────────────────────────────

const CHART_VIEWS = [
  { id: 'budget_actual', label: 'Budget vs Actual', icon: BarChart2 },
  { id: 'variance',      label: 'Variance Only',    icon: Activity  },
];

// ── Component ────────────────────────────────────────────────────────────────

export default function Budgets() {
  const navigate = useNavigate();

  // Raw budget records (used only for edit/delete targeting)
  const [budgets,  setBudgets]  = useState([]);
  // Full account list (used for the category filter dropdown)
  const [accounts, setAccounts] = useState([]);
  // Budget summary rows: { account_id, account_name, user_budget, actual, variance }
  const [summary,  setSummary]  = useState([]);

  const [showForm,   setShowForm]   = useState(false);
  const [chartView,  setChartView]  = useState('budget_actual');

  // Date filter (YYYY-MM-DD from DatePresetPicker — passed directly to the API)
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo,   setDateTo]   = useState('');

  // Category filter
  const [selectedAccount, setSelectedAccount] = useState('');

  // Add-budget form
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [form, setForm] = useState({
    account_id: '',
    month: currentMonth,
    amount: '',
    notes: '',
  });

  // Inline editing state
  const [editingKey,  setEditingKey]  = useState(null);   // String(account_id)
  const [editAmount,  setEditAmount]  = useState('');

  // ── Data loading ─────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    try {
      const [b, a, s] = await Promise.all([
        getBudgets(),
        getAccounts(),
        getBudgetSummary(
          dateFrom || undefined,
          dateTo   || undefined,
          selectedAccount ? parseInt(selectedAccount, 10) : undefined,
        ),
      ]);
      setBudgets(b);
      setAccounts(a);
      setSummary(s);
    } catch (e) {
      console.error('Budget load error:', e);
    }
  }, [dateFrom, dateTo, selectedAccount]);

  useEffect(() => { load(); }, [load]);

  // ── Add-budget form ───────────────────────────────────────────────────────

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.month < currentMonth) {
      alert('Cannot set budgets for past months. Please select the current month or a future month.');
      return;
    }
    try {
      await upsertBudget({
        account_id: parseInt(form.account_id, 10),
        month:      form.month,
        amount:     parseFloat(form.amount),
        notes:      form.notes,
      });
      setForm({ account_id: '', month: currentMonth, amount: '', notes: '' });
      setShowForm(false);
      load();
    } catch (err) {
      alert(`Could not save budget: ${err.message}`);
    }
  };

  const handleDelete = async (id) => {
    if (confirm('Delete this budget entry?')) {
      try {
        await deleteBudget(id);
        load();
      } catch (err) {
        alert(`Could not delete: ${err.message}`);
      }
    }
  };

  // ── Inline editing ───────────────────────────────────────────────────────

  const startEdit = (row) => {
    setEditingKey(String(row.account_id));
    // Pre-fill with the most-recent editable budget for this account,
    // falling back to the summary's user_budget value.
    const acctBudgets   = budgets.filter(b => b.account_id === row.account_id);
    const editableBudget = acctBudgets.find(b => b.month >= currentMonth);
    setEditAmount(
      String(editableBudget ? editableBudget.amount : row.user_budget)
    );
  };

  const cancelEdit = () => { setEditingKey(null); setEditAmount(''); };

  const saveEdit = async (row) => {
    const acctBudgets    = budgets.filter(b => b.account_id === row.account_id);
    const editableBudget = acctBudgets.find(b => b.month >= currentMonth);
    try {
      if (editableBudget) {
        await upsertBudget({
          account_id: row.account_id,
          month:      editableBudget.month,
          amount:     parseFloat(editAmount),
          notes:      editableBudget.notes || '',
        });
      } else {
        // No current/future budget exists — create one for the current month
        await upsertBudget({
          account_id: row.account_id,
          month:      currentMonth,
          amount:     parseFloat(editAmount),
          notes:      '',
        });
      }
      cancelEdit();
      load();
    } catch (err) {
      alert(`Could not save budget: ${err.message}`);
    }
  };

  // ── Drill-down to transactions ────────────────────────────────────────────

  const drillDown = (accountId) => {
    const params = new URLSearchParams();
    params.set('category_id', String(accountId));
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo)   params.set('date_to',   dateTo);
    navigate(`/transactions?${params.toString()}`);
  };

  // ── Chart data ───────────────────────────────────────────────────────────

  const expenseAccounts = accounts.filter(a => a.type === 'expense');

  // Chart uses summary rows: user_budget = Budget bar, actual = Actual bar
  const budgetActualData = summary.map(row => ({
    name:   row.account_name,
    Budget: row.user_budget ?? 0,
    Actual: row.actual ?? 0,
  }));
  const varianceData = summary.map(row => ({
    name:     row.account_name,
    Variance: row.variance ?? 0,
    over:     (row.variance ?? 0) < 0,
  }));

  const periodLabel = dateFrom && dateTo
    ? `${dateFrom} – ${dateTo}`
    : 'All Time';

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Budgets</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Set monthly budgets and track actual spending</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">
          <Plus className="w-4 h-4 mr-2" /> Set Budget
        </button>
      </div>

      {/* ── Filter Bar ─────────────────────────────────────────────────── */}
      <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 space-y-3">
        {/* Category filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mr-1">
            Category
          </span>
          <select
            value={selectedAccount}
            onChange={e => setSelectedAccount(e.target.value)}
            className="input-field w-auto max-w-xs"
          >
            <option value="">All categories</option>
            {expenseAccounts.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          {selectedAccount && (
            <button
              onClick={() => setSelectedAccount('')}
              className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 underline"
            >
              Clear
            </button>
          )}
        </div>

        {/* Date period picker — changing dates re-fetches actual spend */}
        <DatePresetPicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateChange={(from, to) => { setDateFrom(from); setDateTo(to); }}
        />
      </div>

      {/* ── Add Budget Form ─────────────────────────────────────────────── */}
      {showForm && (
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Set Budget</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="label">Month *</label>
              <input
                type="month"
                value={form.month}
                onChange={e => setForm({ ...form, month: e.target.value })}
                min={currentMonth}
                required
                className="input-field"
                title="Budgets can only be set for the current month and future months"
              />
            </div>
            <div>
              <label className="label">Category *</label>
              <GroupedAccountSelect
                accounts={expenseAccounts}
                value={form.account_id}
                onChange={e => setForm({ ...form, account_id: e.target.value })}
                placeholder="Select category..."
                required
              />
            </div>
            <div>
              <label className="label">Monthly Budget Amount *</label>
              <input
                type="number" step="0.01" min="0"
                value={form.amount}
                onChange={e => setForm({ ...form, amount: e.target.value })}
                required
                className="input-field"
                placeholder="5000.00"
              />
            </div>
            <div>
              <label className="label">Notes</label>
              <input
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                className="input-field"
                placeholder="Optional notes"
              />
            </div>
            <div className="flex items-end gap-2">
              <button type="submit" className="btn-primary">
                <Check className="w-4 h-4 mr-1" /> Save
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="btn-secondary"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Chart ──────────────────────────────────────────────────────── */}
      {summary.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold">
                {chartView === 'budget_actual' ? 'Budget vs Actual' : 'Variance by Category'}
              </h3>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{periodLabel}</p>
            </div>
            <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
              {CHART_VIEWS.map(v => {
                const Icon = v.icon;
                return (
                  <button
                    key={v.id}
                    onClick={() => setChartView(v.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      chartView === v.id
                        ? 'bg-white dark:bg-gray-600 text-primary-700 dark:text-primary-400 shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                    }`}
                  >
                    <Icon className="w-4 h-4" />{v.label}
                  </button>
                );
              })}
            </div>
          </div>

          <ResponsiveContainer width="100%" height={Math.max(220, summary.length * 52)}>
            {chartView === 'budget_actual' ? (
              <BarChart data={budgetActualData} layout="vertical" margin={{ left: 20, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" width={160} tick={<CustomYTick />} />
                <Tooltip formatter={(v, name) => [formatMoney(v), name]} />
                <Legend />
                <Bar dataKey="Budget" fill="#93c5fd" radius={[0, 4, 4, 0]} name="User Budget" />
                <Bar dataKey="Actual" fill="#6366f1" radius={[0, 4, 4, 0]} name="Actual" />
              </BarChart>
            ) : (
              <BarChart data={varianceData} layout="vertical" margin={{ left: 20, right: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" width={160} tick={<CustomYTick />} />
                <Tooltip
                  formatter={v => [
                    formatMoney(Math.abs(v)),
                    v >= 0 ? 'Under Budget' : 'Over Budget',
                  ]}
                />
                <ReferenceLine x={0} stroke="#6b7280" strokeWidth={1.5} />
                <Bar dataKey="Variance" radius={[0, 4, 4, 0]}>
                  {varianceData.map((e, i) => (
                    <Cell key={i} fill={e.over ? '#ef4444' : '#10b981'} />
                  ))}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>

          {chartView === 'variance' && (
            <div className="flex gap-6 justify-center mt-2 text-xs text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" /> Under Budget
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-red-500 inline-block" /> Over Budget
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Budget Table ────────────────────────────────────────────────── */}
      <div className="card overflow-hidden p-0">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 flex items-center justify-between">
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
            {periodLabel} — {summary.length} categor{summary.length !== 1 ? 'ies' : 'y'}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                <th className="py-3 px-4 text-left   text-gray-500 dark:text-gray-400 font-medium">Category</th>
                <th className="py-3 px-4 text-right  text-gray-500 dark:text-gray-400 font-medium">User Budget&nbsp;<span className="font-normal text-xs">(monthly)</span></th>
                <th className="py-3 px-4 text-right  text-gray-500 dark:text-gray-400 font-medium">Actual&nbsp;<span className="font-normal text-xs">(monthly avg)</span></th>
                <th className="py-3 px-4 text-right  text-gray-500 dark:text-gray-400 font-medium">Variance</th>
                <th className="py-3 px-4 text-right  text-gray-500 dark:text-gray-400 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row, i) => {
                const userBudget = row.user_budget ?? 0;
                const actual     = row.actual     ?? 0;
                const variance   = row.variance   ?? 0;
                const overBudget = variance < 0;
                const isEditing  = editingKey === String(row.account_id);

                // Find current/future budget record for edit/delete targeting
                const acctBudgets    = budgets.filter(b => b.account_id === row.account_id);
                const editableBudget = acctBudgets.find(b => b.month >= currentMonth);
                const anyBudget      = acctBudgets[0]; // for delete button availability

                return (
                  <tr
                    key={i}
                    className={`border-b border-gray-100 dark:border-gray-700 ${
                      isEditing ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    {/* Category */}
                    <td className="py-3 px-4 font-medium">{row.account_name}</td>

                    {/* User Budget */}
                    <td className="py-3 px-4 text-right">
                      {isEditing ? (
                        <input
                          type="number" step="0.01" min="0"
                          value={editAmount}
                          onChange={e => setEditAmount(e.target.value)}
                          className="w-28 text-right border border-blue-400 rounded px-2 py-1 text-sm
                                     focus:outline-none focus:ring-2 focus:ring-blue-300"
                          autoFocus
                        />
                      ) : (
                        <span className="font-medium">{formatMoney(userBudget)}</span>
                      )}
                    </td>

                    {/* Actual (monthly average over selected period) */}
                    <td className="py-3 px-4 text-right">
                      <span
                        className="cursor-pointer text-blue-600 hover:text-blue-800 hover:underline"
                        onClick={() => drillDown(row.account_id)}
                        title="View transactions for this period"
                      >
                        {formatMoney(actual)}
                      </span>
                    </td>

                    {/* Variance — green if ≥ 0 (under budget), red if < 0 (over budget) */}
                    <td
                      className={`py-3 px-4 text-right font-semibold ${
                        overBudget ? 'text-red-600' : 'text-emerald-600'
                      }`}
                    >
                      <span className="flex items-center justify-end gap-1">
                        {overBudget
                          ? <TrendingUp   className="w-4 h-4 flex-shrink-0" />
                          : variance === 0
                            ? <Minus      className="w-4 h-4 flex-shrink-0" />
                            : <TrendingDown className="w-4 h-4 flex-shrink-0" />
                        }
                        {isEditing
                          ? formatMoney(parseFloat(editAmount || 0) - actual)
                          : formatMoney(variance)
                        }
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => saveEdit(row)}
                            className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50"
                            title="Save"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          {anyBudget && !editableBudget && (
                            <Lock
                              className="w-4 h-4 text-gray-300"
                              title="All budget entries for this category are historical (locked)"
                            />
                          )}
                          <button
                            onClick={() => startEdit(row)}
                            className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-gray-400 dark:text-gray-500 hover:text-blue-600"
                            title={editableBudget ? 'Edit budget' : 'Set budget for current month'}
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          {editableBudget && (
                            <button
                              onClick={() => handleDelete(editableBudget.id)}
                              className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 dark:text-gray-500 hover:text-red-500"
                              title="Delete current/future budget entry"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {summary.length === 0 && (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">
            No budgets found for this period. Click &quot;Set Budget&quot; to add one.
          </div>
        )}
      </div>
    </div>
  );
}
