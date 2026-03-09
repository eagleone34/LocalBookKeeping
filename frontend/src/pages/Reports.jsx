import { useEffect, useState } from 'react';
import { getPnL, getExpenseByCategory, getExpenseByVendor, getMonthlyTrend, getBalanceSheet } from '../api/client';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend, AreaChart, Area
} from 'recharts';

const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'];

function formatMoney(val) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(val);
}

const tabs = ['Profit & Loss', 'Expense by Category', 'Expense by Vendor', 'Monthly Trends', 'Balance Sheet'];

export default function Reports() {
  const [activeTab, setActiveTab] = useState(0);
  const [pnl, setPnl] = useState([]);
  const [categories, setCategories] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [trends, setTrends] = useState([]);
  const [balanceSheet, setBalanceSheet] = useState([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = async () => {
    try {
      const [p, c, v, t, b] = await Promise.all([
        getPnL(dateFrom, dateTo),
        getExpenseByCategory(dateFrom, dateTo),
        getExpenseByVendor(dateFrom, dateTo),
        getMonthlyTrend(12),
        getBalanceSheet(),
      ]);
      setPnl(p);
      setCategories(c);
      setVendors(v);
      setTrends(t);
      setBalanceSheet(b);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { load(); }, [dateFrom, dateTo]);

  // Process P&L data for chart
  const pnlByMonth = {};
  pnl.forEach(r => {
    if (!pnlByMonth[r.month]) pnlByMonth[r.month] = { month: r.month, income: 0, expense: 0 };
    if (r.type === 'income') pnlByMonth[r.month].income = r.total;
    if (r.type === 'expense') pnlByMonth[r.month].expense = Math.abs(r.total);
  });
  const pnlChart = Object.values(pnlByMonth).sort((a, b) => a.month.localeCompare(b.month));
  pnlChart.forEach(r => { r.net = r.income - r.expense; });

  // YTD totals
  const ytdIncome = pnlChart.reduce((s, r) => s + r.income, 0);
  const ytdExpense = pnlChart.reduce((s, r) => s + r.expense, 0);
  const ytdNet = ytdIncome - ytdExpense;

  // Balance sheet groups
  const assets = balanceSheet.filter(r => r.type === 'asset');
  const liabilities = balanceSheet.filter(r => r.type === 'liability');
  const totalAssets = assets.reduce((s, r) => s + r.balance, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + Math.abs(r.balance), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-500 mt-1">Analyze your financial data</p>
        </div>
        <div className="flex gap-3 items-end">
          <div>
            <label className="label">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input-field" />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((tab, i) => (
          <button key={tab} onClick={() => setActiveTab(i)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === i ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Profit & Loss */}
      {activeTab === 0 && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="card text-center">
              <p className="text-sm text-gray-500">Total Income</p>
              <p className="text-2xl font-bold text-emerald-600">{formatMoney(ytdIncome)}</p>
            </div>
            <div className="card text-center">
              <p className="text-sm text-gray-500">Total Expenses</p>
              <p className="text-2xl font-bold text-red-600">{formatMoney(ytdExpense)}</p>
            </div>
            <div className="card text-center">
              <p className="text-sm text-gray-500">Net Income</p>
              <p className={`text-2xl font-bold ${ytdNet >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatMoney(ytdNet)}</p>
            </div>
          </div>
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Monthly Profit & Loss</h3>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={pnlChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={v => formatMoney(v)} />
                <Legend />
                <Bar dataKey="income" fill="#10b981" name="Income" radius={[4,4,0,0]} />
                <Bar dataKey="expense" fill="#ef4444" name="Expenses" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="py-3 px-4 text-left text-gray-500 font-medium">Month</th>
                  <th className="py-3 px-4 text-right text-gray-500 font-medium">Income</th>
                  <th className="py-3 px-4 text-right text-gray-500 font-medium">Expenses</th>
                  <th className="py-3 px-4 text-right text-gray-500 font-medium">Net</th>
                </tr>
              </thead>
              <tbody>
                {pnlChart.map(r => (
                  <tr key={r.month} className="border-b border-gray-100">
                    <td className="py-3 px-4 font-medium">{r.month}</td>
                    <td className="py-3 px-4 text-right text-emerald-600">{formatMoney(r.income)}</td>
                    <td className="py-3 px-4 text-right text-red-600">{formatMoney(r.expense)}</td>
                    <td className={`py-3 px-4 text-right font-bold ${r.net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatMoney(r.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Expense by Category */}
      {activeTab === 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Expense Distribution</h3>
            <ResponsiveContainer width="100%" height={350}>
              <PieChart>
                <Pie data={categories} dataKey="total" nameKey="account_name" cx="50%" cy="50%" outerRadius={120}
                  label={({ account_name, percentage }) => `${account_name} (${percentage}%)`}
                >
                  {categories.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={v => formatMoney(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="py-3 px-4 text-left text-gray-500 font-medium">Category</th>
                  <th className="py-3 px-4 text-right text-gray-500 font-medium">Total</th>
                  <th className="py-3 px-4 text-right text-gray-500 font-medium">%</th>
                  <th className="py-3 px-4 text-left text-gray-500 font-medium w-32">Share</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((r, i) => (
                  <tr key={r.account_id} className="border-b border-gray-100">
                    <td className="py-3 px-4 font-medium flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      {r.account_name}
                    </td>
                    <td className="py-3 px-4 text-right">{formatMoney(r.total)}</td>
                    <td className="py-3 px-4 text-right text-gray-500">{r.percentage}%</td>
                    <td className="py-3 px-4">
                      <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${r.percentage}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Expense by Vendor */}
      {activeTab === 2 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Top Vendors</h3>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={vendors.slice(0, 10)} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="vendor_name" width={140} tick={{ fontSize: 12 }} />
                <Tooltip formatter={v => formatMoney(v)} />
                <Bar dataKey="total" fill="#3b82f6" radius={[0,4,4,0]}>
                  {vendors.slice(0, 10).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="py-3 px-4 text-left text-gray-500 font-medium">Vendor</th>
                  <th className="py-3 px-4 text-right text-gray-500 font-medium">Total</th>
                  <th className="py-3 px-4 text-right text-gray-500 font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map(r => (
                  <tr key={r.vendor_name} className="border-b border-gray-100">
                    <td className="py-3 px-4 font-medium">{r.vendor_name}</td>
                    <td className="py-3 px-4 text-right">{formatMoney(r.total)}</td>
                    <td className="py-3 px-4 text-right text-gray-500">{r.percentage}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Monthly Trends */}
      {activeTab === 3 && (
        <div className="space-y-6">
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Income vs Expenses Over Time</h3>
            <ResponsiveContainer width="100%" height={350}>
              <AreaChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={v => formatMoney(v)} />
                <Legend />
                <Area type="monotone" dataKey="income" fill="#d1fae5" stroke="#10b981" strokeWidth={2} name="Income" />
                <Area type="monotone" dataKey="expenses" fill="#fecaca" stroke="#ef4444" strokeWidth={2} name="Expenses" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Net Income Trend</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={v => formatMoney(v)} />
                <Line type="monotone" dataKey="net" stroke="#3b82f6" strokeWidth={3} dot={{ fill: '#3b82f6', r: 5 }} name="Net Income" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Balance Sheet */}
      {activeTab === 4 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="text-lg font-semibold mb-4 text-blue-700">Assets</h3>
            <table className="w-full text-sm">
              <tbody>
                {assets.map(r => (
                  <tr key={r.account_name} className="border-b border-gray-100">
                    <td className="py-3 px-2 font-medium">{r.account_name}</td>
                    <td className="py-3 px-2 text-right text-blue-600 font-medium">{formatMoney(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-blue-200">
                  <td className="py-3 px-2 font-bold">Total Assets</td>
                  <td className="py-3 px-2 text-right font-bold text-blue-700">{formatMoney(totalAssets)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="card">
            <h3 className="text-lg font-semibold mb-4 text-amber-700">Liabilities</h3>
            <table className="w-full text-sm">
              <tbody>
                {liabilities.map(r => (
                  <tr key={r.account_name} className="border-b border-gray-100">
                    <td className="py-3 px-2 font-medium">{r.account_name}</td>
                    <td className="py-3 px-2 text-right text-amber-600 font-medium">{formatMoney(Math.abs(r.balance))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-amber-200">
                  <td className="py-3 px-2 font-bold">Total Liabilities</td>
                  <td className="py-3 px-2 text-right font-bold text-amber-700">{formatMoney(totalLiabilities)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="card lg:col-span-2 text-center">
            <p className="text-sm text-gray-500">Net Worth (Assets - Liabilities)</p>
            <p className={`text-3xl font-bold ${totalAssets - totalLiabilities >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {formatMoney(totalAssets - totalLiabilities)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
