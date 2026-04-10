import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPnL, getExpenseByCategory, getExpenseByVendor, getMonthlyTrend, getBalanceSheet, getBankAccounts } from '../api/client';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend, AreaChart, Area
} from 'recharts';
import DatePresetPicker from '../components/DatePresetPicker';
import { useCurrency } from '../hooks/useCurrency';
import SecondaryAmount from '../components/SecondaryAmount';

const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'];

function getColor(name) {
  if (!name) return COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
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

const tabs = ['Profit & Loss', 'Expense by Category', 'Expense by Vendor', 'Monthly Trends', 'Balance Sheet'];

export default function Reports() {
  const { formatMoney, formatPrimary, globalCurrency } = useCurrency();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(0);
  const [pnl, setPnl] = useState([]);
  const [categories, setCategories] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [trends, setTrends] = useState([]);
  const [balanceSheet, setBalanceSheet] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [selectedBankAccountId, setSelectedBankAccountId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showSecondary, setShowSecondary] = useState(false);

  // Determine selected account's currency for multi-currency display
  const selectedBa = bankAccounts.find(ba => String(ba.id) === selectedBankAccountId);
  const selectedAccountCurrency = selectedBa?.ledger_account_currency || selectedBa?.currency || globalCurrency;
  const isMultiCurrency = selectedBankAccountId && selectedAccountCurrency !== globalCurrency;
  const fmt = (val) => selectedBankAccountId
    ? formatPrimary(val ?? 0, selectedAccountCurrency)
    : formatMoney(val ?? 0);

  /** Navigate to Transactions page with current date/bank filters + extra params */
  const drillDown = (extraParams = {}) => {
    const params = new URLSearchParams();
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (selectedBankAccountId) params.set('bank_account_id', selectedBankAccountId);
    Object.entries(extraParams).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    });
    navigate(`/transactions?${params.toString()}`);
  };

  const load = async () => {
    try {
      const [p, c, v, t, b, ba] = await Promise.all([
        getPnL(dateFrom, dateTo, selectedBankAccountId || null),
        getExpenseByCategory(dateFrom, dateTo, selectedBankAccountId || null),
        getExpenseByVendor(dateFrom, dateTo, selectedBankAccountId || null),
        getMonthlyTrend(12, selectedBankAccountId || null),
        getBalanceSheet(),
        getBankAccounts(),
      ]);
      setPnl(p);
      setCategories(c);
      setVendors(v);
      setTrends(t);
      setBalanceSheet(b);
      setBankAccounts(ba);
    } catch (e) { console.error(e); }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [dateFrom, dateTo, selectedBankAccountId]);

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

  // Grand totals for category & vendor tables
  const grandTotal = categories.reduce((sum, r) => sum + r.total, 0);
  const vendorGrandTotal = vendors.reduce((sum, r) => sum + r.total, 0);

  // Date range display label
  const dateRangeLabel = (() => {
    if (!dateFrom && !dateTo) return 'All Time';
    const opts = { month: 'short', day: 'numeric', year: 'numeric' };
    const from = dateFrom ? new Date(dateFrom + 'T12:00:00').toLocaleDateString('en-US', opts) : '';
    const to = dateTo ? new Date(dateTo + 'T12:00:00').toLocaleDateString('en-US', opts) : '';
    if (from && to) return `${from} – ${to}`;
    if (from) return `From ${from}`;
    return `Up to ${to}`;
  })();

  // Balance sheet groups
  const assets = balanceSheet.filter(r => r.type === 'asset');
  const liabilities = balanceSheet.filter(r => r.type === 'liability');
  const totalAssets = assets.reduce((s, r) => s + r.balance, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + Math.abs(r.balance), 0);
  
  return (
    <div className="space-y-6">
      {/* Page heading */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Reports</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Analyze your financial data</p>
      </div>

      {/* Filter toolbar */}
      <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <select
          value={selectedBankAccountId}
          onChange={(e) => setSelectedBankAccountId(e.target.value)}
          className="input-field max-w-xs"
        >
          <option value="">All accounts</option>
          {bankAccounts.map(ba => (
            <option key={ba.id} value={ba.id}>
              {ba.ledger_account_name || ba.bank_name}
            </option>
          ))}
        </select>
        {isMultiCurrency && (
          <button
            onClick={() => setShowSecondary(s => !s)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${showSecondary ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300' : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'}`}
          >
            {showSecondary ? `Hide ${selectedAccountCurrency}` : `Show ${selectedAccountCurrency}`}
          </button>
        )}
        <div className="flex items-center gap-3">
          <DatePresetPicker
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateChange={(from, to) => { setDateFrom(from); setDateTo(to); }}
          />
        </div>
      </div>

      {/* Active date range label */}
      <div className="flex justify-end -mt-3">
        <span className="text-xs text-gray-400 dark:text-gray-500">{dateRangeLabel}</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {tabs.map((tab, i) => (
          <button key={tab} onClick={() => setActiveTab(i)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === i ? 'border-primary-600 text-primary-700 dark:text-primary-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
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
            <div className="card text-center cursor-pointer hover:shadow-md hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-all" onClick={() => drillDown({ category_type: 'income' })}>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Income</p>
              <p className="text-2xl font-bold text-emerald-600">{fmt(ytdIncome)}<SecondaryAmount amount={ytdIncome} accountCurrency={selectedAccountCurrency} show={showSecondary && !!isMultiCurrency} /></p>
            </div>
            <div className="card text-center cursor-pointer hover:shadow-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-all" onClick={() => drillDown({ category_type: 'expense' })}>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Expenses</p>
              <p className="text-2xl font-bold text-red-600">{fmt(ytdExpense)}<SecondaryAmount amount={ytdExpense} accountCurrency={selectedAccountCurrency} show={showSecondary && !!isMultiCurrency} /></p>
            </div>
            <div className="card text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">Net Income</p>
              <p className={`text-2xl font-bold ${ytdNet >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(ytdNet)}<SecondaryAmount amount={ytdNet} accountCurrency={selectedAccountCurrency} show={showSecondary && !!isMultiCurrency} /></p>
            </div>
          </div>
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Monthly Profit & Loss</h3>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={pnlChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={v => fmt(v)} />
                <Legend />
                <Bar dataKey="income" fill="#10b981" name="Income" radius={[4,4,0,0]} />
                <Bar dataKey="expense" fill="#ef4444" name="Expenses" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-3 px-4 text-left text-gray-500 dark:text-gray-400 font-medium">Month</th>
                  <th className="py-3 px-4 text-right text-gray-500 dark:text-gray-400 font-medium">Income</th>
                  <th className="py-3 px-4 text-right text-gray-500 dark:text-gray-400 font-medium">Expenses</th>
                  <th className="py-3 px-4 text-right text-gray-500 dark:text-gray-400 font-medium">Net</th>
                </tr>
              </thead>
              <tbody>
                {pnlChart.map(r => (
                  <tr key={r.month} className="border-b border-gray-100 dark:border-gray-700 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                      onClick={() => drillDown({ date_from: `${r.month}-01`, date_to: `${r.month}-31` })}>
                    <td className="py-3 px-4 font-medium">{r.month}</td>
                    <td className="py-3 px-4 text-right text-emerald-600">{fmt(r.income)}</td>
                    <td className="py-3 px-4 text-right text-red-600">{fmt(r.expense)}</td>
                    <td className={`py-3 px-4 text-right font-bold ${r.net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(r.net)}</td>
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
                <Pie data={categories} dataKey="total" nameKey="account_name" cx="50%" cy="50%" outerRadius={120}>
                  {categories.map((r, i) => <Cell key={i} fill={getColor(r.account_name)} />)}
                </Pie>
                <Tooltip formatter={(v, name) => [fmt(v), name]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-3 px-4 text-left text-gray-500 dark:text-gray-400 font-medium">Category</th>
                  <th className="py-3 px-4 text-right text-gray-500 dark:text-gray-400 font-medium">Total</th>
                  <th className="py-3 px-4 text-right text-gray-500 dark:text-gray-400 font-medium">%</th>
                  <th className="py-3 px-4 text-left text-gray-500 dark:text-gray-400 font-medium w-32">Share</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((r) => (
                  <tr key={r.account_id} className="border-b border-gray-100 dark:border-gray-700 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                      onClick={() => drillDown({ category_id: r.account_id })}>
                    <td className="py-3 px-4 font-medium flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getColor(r.account_name) }} />
                      {r.account_name}
                    </td>
                    <td className="py-3 px-4 text-right">{fmt(r.total)}</td>
                    <td className="py-3 px-4 text-right text-gray-500 dark:text-gray-400">{r.percentage}%</td>
                    <td className="py-3 px-4">
                      <div className="w-full h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${r.percentage}%`, backgroundColor: getColor(r.account_name) }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold border-t-2 border-gray-300 dark:border-gray-600">
                  <td className="py-3 px-4">Total</td>
                  <td className="py-3 px-4 text-right">{fmt(grandTotal)}</td>
                  <td className="py-3 px-4 text-right">100%</td>
                  <td></td>
                </tr>
              </tfoot>
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
                <YAxis type="category" dataKey="vendor_name" width={160} tick={<CustomYTick />} />
                <Tooltip formatter={v => fmt(v)} />
                <Bar dataKey="total" fill="#3b82f6" radius={[0,4,4,0]}>
                  {vendors.slice(0, 10).map((r, i) => <Cell key={i} fill={getColor(r.vendor_name)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-3 px-4 text-left text-gray-500 dark:text-gray-400 font-medium">Vendor</th>
                  <th className="py-3 px-4 text-right text-gray-500 dark:text-gray-400 font-medium">Total</th>
                  <th className="py-3 px-4 text-right text-gray-500 dark:text-gray-400 font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map(r => (
                  <tr key={r.vendor_name} className="border-b border-gray-100 dark:border-gray-700 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                      onClick={() => drillDown({ search: r.vendor_name })}>
                    <td className="py-3 px-4 font-medium">{r.vendor_name}</td>
                    <td className="py-3 px-4 text-right">{fmt(r.total)}</td>
                    <td className="py-3 px-4 text-right text-gray-500 dark:text-gray-400">{r.percentage}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold border-t-2 border-gray-300 dark:border-gray-600">
                  <td className="py-3 px-4">Total</td>
                  <td className="py-3 px-4 text-right">{fmt(vendorGrandTotal)}</td>
                  <td className="py-3 px-4 text-right">100%</td>
                </tr>
              </tfoot>
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
                <Tooltip formatter={v => fmt(v)} />
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
                <Tooltip formatter={v => fmt(v)} />
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
                  <tr key={r.account_name} className="border-b border-gray-100 dark:border-gray-700 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                      onClick={() => drillDown({ category_id: r.account_id })}>
                    <td className="py-3 px-2 font-medium">{r.account_name}</td>
                    <td className="py-3 px-2 text-right text-blue-600 font-medium">{fmt(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-blue-200">
                  <td className="py-3 px-2 font-bold">Total Assets</td>
                  <td className="py-3 px-2 text-right font-bold text-blue-700">{fmt(totalAssets)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="space-y-6">
            <div className="card">
              <h3 className="text-lg font-semibold mb-4 text-amber-700">Liabilities</h3>
              <table className="w-full text-sm">
                <tbody>
                  {liabilities.map(r => (
                    <tr key={r.account_name} className="border-b border-gray-100 dark:border-gray-700 cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                        onClick={() => drillDown({ category_id: r.account_id })}>
                      <td className="py-3 px-2 font-medium">{r.account_name}</td>
                      <td className="py-3 px-2 text-right text-amber-600 font-medium">{fmt(Math.abs(r.balance))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-amber-200">
                    <td className="py-3 px-2 font-bold">Total Liabilities</td>
                    <td className="py-3 px-2 text-right font-bold text-amber-700">{fmt(totalLiabilities)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="card">
              <h3 className="text-lg font-semibold mb-4 text-purple-700">Equity</h3>
              <table className="w-full text-sm">
                <tbody>
                  {balanceSheet.filter(r => r.type === 'equity').map(r => (
                    <tr key={r.account_name} className="border-b border-gray-100 dark:border-gray-700 cursor-pointer hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"
                        onClick={() => drillDown({ category_id: r.account_id })}>
                      <td className="py-3 px-2 font-medium">{r.account_name}</td>
                      <td className="py-3 px-2 text-right text-purple-600 font-medium">{fmt(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-purple-200">
                    <td className="py-3 px-2 font-bold">Total Equity</td>
                    <td className="py-3 px-2 text-right font-bold text-purple-700">
                      {fmt(balanceSheet.filter(r => r.type === 'equity').reduce((s, r) => s + r.balance, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          <div className="card lg:col-span-2 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">Net Worth (Assets - Liabilities)</p>
            <p className={`text-3xl font-bold ${totalAssets - totalLiabilities >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {fmt(totalAssets - totalLiabilities)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
