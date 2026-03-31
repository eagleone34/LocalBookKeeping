import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getAccountLedger, getAccountBalance, getBankAccounts } from '../api/client';
import {
  ArrowLeft, Scale, CheckCircle2, Clock, ExternalLink,
  TrendingUp, TrendingDown,
} from 'lucide-react';
import DatePresetPicker from '../components/DatePresetPicker';
import { useCurrency } from '../hooks/useCurrency';
import SecondaryAmount from '../components/SecondaryAmount';

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso + 'T12:00:00').toLocaleDateString('en-CA', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function AccountLedger() {
  const { formatPrimary, globalCurrency } = useCurrency();
  const { accountId } = useParams();
  const navigate = useNavigate();

  const [accountInfo, setAccountInfo] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showSecondary, setShowSecondary] = useState(false);

  const accountCurrency = accountInfo?.currency || 'USD';
  const isMultiCurrency = accountCurrency !== globalCurrency;
  const formatMoney = (val) => formatPrimary(val ?? 0, accountCurrency, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const load = async () => {
    setLoading(true);
    try {
      const [info, rows, bas] = await Promise.all([
        getAccountBalance(parseInt(accountId)),
        getAccountLedger(parseInt(accountId), dateFrom || undefined, dateTo || undefined),
        getBankAccounts(),
      ]);
      setAccountInfo(info);
      setLedger(rows);
      setBankAccounts(bas);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [accountId, dateFrom, dateTo]);

  // Find the linked bank account for this ledger account
  const linkedBankAccount = bankAccounts.find(ba => ba.ledger_account_id === parseInt(accountId));

  const currentBalance = ledger.length > 0 ? ledger[ledger.length - 1].running_balance : 0;
  const reconciledCount = ledger.filter(r => r.is_reconciled).length;
  const unreconciledCount = ledger.filter(r => !r.is_reconciled).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 dark:text-gray-500">Loading ledger...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/accounts')}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          title="Back to Accounts"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {accountInfo?.account_name || 'Account Ledger'}
          </h1>
          <div className="flex items-center gap-3 mt-1 text-sm text-gray-500 dark:text-gray-400">
            {accountInfo?.bank_name && (
              <span className="font-medium text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded border border-blue-100 dark:border-blue-800">
                {accountInfo.bank_name}
                {accountInfo.last_four ? ` ****${accountInfo.last_four}` : ''}
              </span>
            )}
            <span className="capitalize badge bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">{accountInfo?.account_type}</span>
            {accountInfo?.last_reconciled_date && (
              <span className="flex items-center gap-1 text-emerald-600">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Last reconciled: {formatDate(accountInfo.last_reconciled_date)}
                {accountInfo.last_reconciled_balance !== null && (
                  <span className="text-gray-400 dark:text-gray-500 ml-1">
                    ({formatMoney(accountInfo.last_reconciled_balance)})
                  </span>
                )}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isMultiCurrency && (
            <button
              onClick={() => setShowSecondary(s => !s)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${showSecondary ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300' : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'}`}
            >
              {showSecondary ? `Hide ${accountCurrency}` : `Show ${accountCurrency}`}
            </button>
          )}
          {/* Reconcile button */}
          {linkedBankAccount && (
            <Link
              to={`/reconciliation/${linkedBankAccount.id}`}
              className="btn-primary flex items-center gap-2"
            >
              <Scale className="w-4 h-4" />
              Reconcile Account
            </Link>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card text-center py-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Current Balance</p>
          <p className={`text-xl font-bold ${currentBalance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {formatMoney(currentBalance)}
            <SecondaryAmount amount={currentBalance} accountCurrency={accountCurrency} show={showSecondary} />
          </p>
        </div>
        <div className="card text-center py-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Transactions</p>
          <p className="text-xl font-bold text-gray-800 dark:text-gray-200">{ledger.length}</p>
        </div>
        <div className="card text-center py-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center justify-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Reconciled
          </p>
          <p className="text-xl font-bold text-emerald-600">{reconciledCount}</p>
        </div>
        <div className="card text-center py-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center justify-center gap-1">
            <Clock className="w-3 h-3 text-amber-500" /> Unreconciled
          </p>
          <p className="text-xl font-bold text-amber-600">{unreconciledCount}</p>
        </div>
      </div>

      {/* Date filter */}
      <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
        <DatePresetPicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateChange={(from, to) => { setDateFrom(from); setDateTo(to); }}
        />
      </div>

      {/* Ledger table */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                <th className="py-3 px-4 text-left text-gray-500 dark:text-gray-400 font-medium w-32">Date</th>
                <th className="py-3 px-4 text-left text-gray-500 dark:text-gray-400 font-medium">Vendor</th>
                <th className="py-3 px-4 text-left text-gray-500 dark:text-gray-400 font-medium">Description</th>
                <th className="py-3 px-4 text-right text-gray-500 dark:text-gray-400 font-medium w-28">Amount</th>
                <th className="py-3 px-4 text-right text-gray-500 dark:text-gray-400 font-medium w-36">Running Balance</th>
                <th className="py-3 px-4 text-center text-gray-500 dark:text-gray-400 font-medium w-28">Status</th>
              </tr>
            </thead>
            <tbody>
              {ledger.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-gray-400 dark:text-gray-500">
                    No transactions found for this account
                    {(dateFrom || dateTo) ? ' in the selected period' : ''}.
                  </td>
                </tr>
              ) : (
                ledger.map((row) => {
                  const isPositive = row.amount >= 0;
                  const balancePositive = row.running_balance >= 0;

                  return (
                    <tr
                      key={row.id}
                      className={`border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                        row.is_reconciled ? 'bg-emerald-50/20' : ''
                      }`}
                    >
                      <td className="py-3 px-4 whitespace-nowrap text-gray-600 dark:text-gray-400 text-xs">
                        {formatDate(row.txn_date)}
                      </td>
                      <td className="py-3 px-4 font-medium text-gray-800 dark:text-gray-200">
                        {row.vendor_name || <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                      <td className="py-3 px-4 text-gray-500 dark:text-gray-400 max-w-xs truncate" title={row.description}>
                        {row.description || <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                      <td className={`py-3 px-4 text-right font-semibold whitespace-nowrap ${
                        isPositive ? 'text-emerald-600' : 'text-red-600'
                      }`}>
                        <span className="flex items-center justify-end gap-1">
                          {isPositive
                            ? <TrendingUp className="w-3 h-3" />
                            : <TrendingDown className="w-3 h-3" />
                          }
                          {formatMoney(row.amount)}
                          <SecondaryAmount amount={row.amount} accountCurrency={accountCurrency} show={showSecondary} />
                        </span>
                      </td>
                      <td className={`py-3 px-4 text-right font-bold whitespace-nowrap ${
                        balancePositive ? 'text-gray-800' : 'text-red-700'
                      }`}>
                        {formatMoney(row.running_balance)}
                        <SecondaryAmount amount={row.running_balance} accountCurrency={accountCurrency} show={showSecondary} />
                      </td>
                      <td className="py-3 px-4 text-center">
                        {row.is_reconciled ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
                            <CheckCircle2 className="w-3 h-3" /> Cleared
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 text-xs font-medium">
                            <Clock className="w-3 h-3" /> Pending
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {ledger.length > 0 && (
              <tfoot>
                <tr className="bg-gray-50 dark:bg-gray-700/50 border-t-2 border-gray-300 dark:border-gray-600">
                  <td colSpan={3} className="py-3 px-4 font-bold text-gray-700 dark:text-gray-300">
                    Closing Balance
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-gray-700 dark:text-gray-300">
                    {formatMoney(ledger.reduce((s, r) => s + r.amount, 0))}
                  </td>
                  <td className={`py-3 px-4 text-right font-bold text-lg ${
                    currentBalance >= 0 ? 'text-emerald-700' : 'text-red-700'
                  }`}>
                    {formatMoney(currentBalance)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Link to transactions page */}
      {linkedBankAccount && (
        <div className="text-center">
          <Link
            to={`/transactions?bank_account_id=${linkedBankAccount.id}`}
            className="inline-flex items-center gap-2 text-sm text-primary-600 hover:text-primary-800 font-medium"
          >
            <ExternalLink className="w-4 h-4" />
            View all transactions for this account in Transactions page
          </Link>
        </div>
      )}
    </div>
  );
}
