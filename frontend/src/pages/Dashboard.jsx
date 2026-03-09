import { useEffect, useState } from 'react';
import { getDashboard } from '../api/client';
import {
  TrendingUp, TrendingDown, DollarSign, Wallet, CreditCard, FileText,
  ArrowUpRight, ArrowDownRight
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend
} from 'recharts';

const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

function formatMoney(val) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(val);
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDashboard().then(setData).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="text-gray-400">Loading...</div></div>;
  if (!data) return <div className="text-red-500">Failed to load dashboard</div>;

  const cards = [
    { label: 'Total Income', value: data.total_income, icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Total Expenses', value: data.total_expenses, icon: TrendingDown, color: 'text-red-600', bg: 'bg-red-50' },
    { label: 'Net Income', value: data.net_income, icon: DollarSign, color: data.net_income >= 0 ? 'text-emerald-600' : 'text-red-600', bg: data.net_income >= 0 ? 'bg-emerald-50' : 'bg-red-50' },
    { label: 'Net Worth', value: data.net_worth, icon: Wallet, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Transactions', value: data.transaction_count, icon: FileText, color: 'text-gray-600', bg: 'bg-gray-50', isCount: true },
    { label: 'Pending Review', value: data.pending_review_count, icon: CreditCard, color: 'text-amber-600', bg: 'bg-amber-50', isCount: true },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 mt-1">Your financial overview at a glance</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map(({ label, value, icon: Icon, color, bg, isCount }) => (
          <div key={label} className="card flex items-center gap-4">
            <div className={`p-3 rounded-lg ${bg}`}>
              <Icon className={`w-6 h-6 ${color}`} />
            </div>
            <div>
              <p className="text-sm text-gray-500">{label}</p>
              <p className={`text-2xl font-bold ${color}`}>
                {isCount ? value.toLocaleString() : formatMoney(value)}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Trend */}
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Monthly Trend</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.monthly_trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={v => formatMoney(v)} />
              <Legend />
              <Bar dataKey="income" fill="#10b981" name="Income" radius={[4,4,0,0]} />
              <Bar dataKey="expenses" fill="#ef4444" name="Expenses" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Expense Breakdown */}
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Expense Breakdown</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={data.top_expense_categories}
                dataKey="total"
                nameKey="account_name"
                cx="50%" cy="50%"
                outerRadius={100}
                label={({ account_name, percentage }) => `${account_name} (${percentage}%)`}
                labelLine={{ strokeWidth: 1 }}
              >
                {data.top_expense_categories.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={v => formatMoney(v)} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Net Income Trend */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Net Income Trend</h3>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={data.monthly_trend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
            <Tooltip formatter={v => formatMoney(v)} />
            <Line type="monotone" dataKey="net" stroke="#3b82f6" strokeWidth={3} dot={{ fill: '#3b82f6', r: 4 }} name="Net Income" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Recent Transactions */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Recent Transactions</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-2 text-gray-500 font-medium">Date</th>
                <th className="text-left py-3 px-2 text-gray-500 font-medium">Vendor</th>
                <th className="text-left py-3 px-2 text-gray-500 font-medium">Description</th>
                <th className="text-left py-3 px-2 text-gray-500 font-medium">Category</th>
                <th className="text-right py-3 px-2 text-gray-500 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.recent_transactions.map(txn => (
                <tr key={txn.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-3 px-2">{txn.txn_date}</td>
                  <td className="py-3 px-2 font-medium">{txn.vendor_name || '-'}</td>
                  <td className="py-3 px-2 text-gray-500 max-w-xs truncate">{txn.description}</td>
                  <td className="py-3 px-2">
                    <span className={`badge-${txn.account_type}`}>{txn.account_name}</span>
                  </td>
                  <td className={`py-3 px-2 text-right font-medium ${txn.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatMoney(txn.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
