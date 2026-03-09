import { useEffect, useState } from 'react';
import { getBudgets, getAccounts, upsertBudget, deleteBudget, getBudgetVsActual } from '../api/client';
import { Plus, Trash2, Check, X, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from 'recharts';

function formatMoney(val) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(val);
}

export default function Budgets() {
  const [budgets, setBudgets] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [bva, setBva] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [form, setForm] = useState({ account_id: '', month: new Date().toISOString().slice(0, 7), amount: '', notes: '' });

  const load = async () => {
    try {
      const [b, a, bvaData] = await Promise.all([
        getBudgets(selectedMonth || undefined),
        getAccounts(),
        getBudgetVsActual(selectedMonth || undefined),
      ]);
      setBudgets(b);
      setAccounts(a);
      setBva(bvaData);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { load(); }, [selectedMonth]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    await upsertBudget({ account_id: parseInt(form.account_id), month: form.month, amount: parseFloat(form.amount), notes: form.notes });
    setForm({ account_id: '', month: form.month, amount: '', notes: '' });
    setShowForm(false);
    load();
  };

  const handleDelete = async (id) => {
    if (confirm('Delete this budget entry?')) {
      await deleteBudget(id);
      load();
    }
  };

  // Get unique months from budgets
  const months = [...new Set(budgets.map(b => b.month))].sort().reverse();

  // Chart data for budget vs actual
  const chartData = bva.map(row => ({
    name: row.account_name.length > 15 ? row.account_name.slice(0, 15) + '...' : row.account_name,
    Budget: row.budgeted,
    Actual: Math.abs(row.actual),
    variance: row.variance,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Budgets</h1>
          <p className="text-gray-500 mt-1">Set monthly budgets and track actual spending</p>
        </div>
        <div className="flex gap-3">
          <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="input-field w-auto">
            <option value="">All months</option>
            {months.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <button onClick={() => setShowForm(true)} className="btn-primary">
            <Plus className="w-4 h-4 mr-2" /> Set Budget
          </button>
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
              <select value={form.account_id} onChange={e => setForm({...form, account_id: e.target.value})} required className="input-field">
                <option value="">Select account...</option>
                {accounts.filter(a => a.type === 'expense').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
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

      {/* Budget vs Actual Chart */}
      {chartData.length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Budget vs Actual</h3>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
              <Tooltip formatter={v => formatMoney(v)} />
              <Legend />
              <Bar dataKey="Budget" fill="#93c5fd" radius={[0,4,4,0]} />
              <Bar dataKey="Actual" radius={[0,4,4,0]}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.Actual > entry.Budget ? '#ef4444' : '#10b981'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Budget Table */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="py-3 px-4 text-left text-gray-500 font-medium">Month</th>
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
                const pct = row.budgeted > 0 ? (Math.abs(row.actual) / row.budgeted * 100) : 0;
                const overBudget = Math.abs(row.actual) > row.budgeted;
                return (
                  <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4 font-medium">{row.month}</td>
                    <td className="py-3 px-4">{row.account_name}</td>
                    <td className="py-3 px-4 text-right">{formatMoney(row.budgeted)}</td>
                    <td className="py-3 px-4 text-right">{formatMoney(Math.abs(row.actual))}</td>
                    <td className={`py-3 px-4 text-right font-medium ${overBudget ? 'text-red-600' : 'text-emerald-600'}`}>
                      {formatMoney(row.variance)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {overBudget
                          ? <TrendingUp className="w-4 h-4 text-red-500" />
                          : pct > 80
                          ? <Minus className="w-4 h-4 text-amber-500" />
                          : <TrendingDown className="w-4 h-4 text-emerald-500" />
                        }
                        <span className="text-xs text-gray-500">{pct.toFixed(0)}%</span>
                        {/* Progress bar */}
                        <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${overBudget ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {budgets.find(b => b.month === row.month && b.account_id === row.account_id) && (
                        <button
                          onClick={() => handleDelete(budgets.find(b => b.month === row.month && b.account_id === row.account_id).id)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {bva.length === 0 && <div className="p-8 text-center text-gray-400">No budgets set yet. Click "Set Budget" to get started.</div>}
      </div>
    </div>
  );
}
