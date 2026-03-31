import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  getReconciliationStatus, getBalanceAsOf, saveReconciliation,
  getReconciliationHistory,
} from '../api/client';
import {
  ArrowLeft, CheckCircle2, AlertTriangle, Scale, Clock,
  ChevronDown, ChevronUp, History, Check, X,
} from 'lucide-react';
import { useCurrency } from '../hooks/useCurrency';

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

export default function Reconciliation() {
  const { formatMoney: formatMoneyHook } = useCurrency();
  const formatMoney = (val) => formatMoneyHook(val ?? 0, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const { bankAccountId } = useParams();
  const navigate = useNavigate();
  const baId = parseInt(bankAccountId);

  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Form state
  const [statementDate, setStatementDate] = useState(new Date().toISOString().slice(0, 10));
  const [statementBalance, setStatementBalance] = useState('');
  const [notes, setNotes] = useState('');
  const [localBooksBalance, setLocalBooksBalance] = useState(null);
  const [loadingBalance, setLoadingBalance] = useState(false);

  // Which transactions the user has checked off
  const [checkedIds, setCheckedIds] = useState(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, h] = await Promise.all([
        getReconciliationStatus(baId),
        getReconciliationHistory(baId),
      ]);
      setStatus(s);
      setHistory(h);
      // Pre-check all unreconciled transactions
      setCheckedIds(new Set(s.unreconciled_transactions.map(t => t.id)));
    } catch (err) {
      setError('Failed to load reconciliation data: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [baId]);

  useEffect(() => { load(); }, [load]);

  // Fetch LocalBooks balance whenever statement date changes
  useEffect(() => {
    if (!statementDate) return;
    setLoadingBalance(true);
    getBalanceAsOf(baId, statementDate)
      .then(r => setLocalBooksBalance(r.balance))
      .catch(() => setLocalBooksBalance(null))
      .finally(() => setLoadingBalance(false));
  }, [baId, statementDate]);

  const toggleCheck = (id) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!status) return;
    const allIds = status.unreconciled_transactions.map(t => t.id);
    if (checkedIds.size === allIds.length) {
      setCheckedIds(new Set());
    } else {
      setCheckedIds(new Set(allIds));
    }
  };

  const parsedStatementBalance = parseFloat(statementBalance);
  const difference = (!isNaN(parsedStatementBalance) && localBooksBalance !== null)
    ? parsedStatementBalance - localBooksBalance
    : null;
  const isBalanced = difference !== null && Math.abs(difference) < 0.01;

  const handleReconcile = async () => {
    if (!statementDate || isNaN(parsedStatementBalance)) {
      setError('Please enter a valid statement date and balance.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccessMsg('');
    try {
      await saveReconciliation(baId, {
        statement_date: statementDate,
        statement_balance: parsedStatementBalance,
        notes: notes || undefined,
        transaction_ids: [...checkedIds],
      });
      setSuccessMsg(
        isBalanced
          ? `✓ Reconciliation complete! ${checkedIds.size} transaction(s) marked as cleared.`
          : `Reconciliation saved with a discrepancy of ${formatMoney(difference)}. ${checkedIds.size} transaction(s) marked as cleared.`
      );
      await load();
      setStatementBalance('');
      setNotes('');
    } catch (err) {
      setError('Reconciliation failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 dark:text-gray-500">Loading reconciliation...</div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="text-center py-12 text-red-500">
        {error || 'Bank account not found.'}
      </div>
    );
  }

  const allChecked = status.unreconciled_transactions.length > 0 &&
    checkedIds.size === status.unreconciled_transactions.length;
  const someChecked = checkedIds.size > 0 && !allChecked;

  // Sum of checked transactions
  const checkedSum = status.unreconciled_transactions
    .filter(t => checkedIds.has(t.id))
    .reduce((s, t) => s + t.amount, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Scale className="w-6 h-6 text-primary-600" />
            Reconcile Account
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-0.5">
            {status.bank_name}
            {status.last_four ? ` ****${status.last_four}` : ''}
          </p>
        </div>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          <History className="w-4 h-4" />
          History
          {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {/* Success / Error messages */}
      {successMsg && (
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 px-4 py-3 rounded-lg flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          {successMsg}
        </div>
      )}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Reconciliation History */}
      {showHistory && (
        <div className="card">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
            <History className="w-4 h-4 text-gray-500" />
            Reconciliation History
          </h3>
          {history.length === 0 ? (
            <p className="text-gray-400 dark:text-gray-500 text-sm">No reconciliations yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="py-2 px-3 text-left text-gray-500 dark:text-gray-400 font-medium">Date</th>
                  <th className="py-2 px-3 text-right text-gray-500 dark:text-gray-400 font-medium">Statement Balance</th>
                  <th className="py-2 px-3 text-right text-gray-500 dark:text-gray-400 font-medium">LocalBooks Balance</th>
                  <th className="py-2 px-3 text-right text-gray-500 dark:text-gray-400 font-medium">Difference</th>
                  <th className="py-2 px-3 text-center text-gray-500 dark:text-gray-400 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map(rec => (
                  <tr key={rec.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="py-2 px-3">{formatDate(rec.reconciled_date)}</td>
                    <td className="py-2 px-3 text-right font-medium">{formatMoney(rec.statement_balance)}</td>
                    <td className="py-2 px-3 text-right">{formatMoney(rec.localbooks_balance)}</td>
                    <td className={`py-2 px-3 text-right font-semibold ${Math.abs(rec.difference) < 0.01 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {formatMoney(rec.difference)}
                    </td>
                    <td className="py-2 px-3 text-center">
                      {rec.status === 'reconciled' ? (
                        <span className="badge bg-emerald-100 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400">Balanced</span>
                      ) : (
                        <span className="badge bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400">Discrepancy</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Status summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card text-center py-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Last Reconciled</p>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {status.last_reconciled_date ? formatDate(status.last_reconciled_date) : 'Never'}
          </p>
          {status.last_reconciled_balance !== null && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{formatMoney(status.last_reconciled_balance)}</p>
          )}
        </div>
        <div className="card text-center py-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Current Balance</p>
          <p className={`text-lg font-bold ${status.localbooks_balance_today >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {formatMoney(status.localbooks_balance_today)}
          </p>
        </div>
        <div className="card text-center py-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Unreconciled</p>
          <p className="text-lg font-bold text-amber-600">{status.unreconciled_count}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">transactions</p>
        </div>
        <div className="card text-center py-4">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Checked Sum</p>
          <p className={`text-lg font-bold ${checkedSum >= 0 ? 'text-gray-800 dark:text-gray-200' : 'text-red-600'}`}>
            {formatMoney(checkedSum)}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">{checkedIds.size} selected</p>
        </div>
      </div>

      {/* Reconciliation form */}
      <div className="card">
        <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-4">New Reconciliation</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="label">Statement Date *</label>
            <input
              type="date"
              value={statementDate}
              onChange={e => setStatementDate(e.target.value)}
              className="input-field"
            />
          </div>
          <div>
            <label className="label">Statement Balance *</label>
            <input
              type="number"
              step="0.01"
              value={statementBalance}
              onChange={e => setStatementBalance(e.target.value)}
              placeholder="e.g. 50161.39"
              className="input-field"
            />
          </div>
          <div>
            <label className="label">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. January 2026 statement"
              className="input-field"
            />
          </div>
        </div>

        {/* Balance comparison */}
        <div className={`rounded-lg p-4 mb-4 border ${
          difference === null
            ? 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600'
            : isBalanced
              ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
              : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
        }`}>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Statement Balance</p>
              <p className="text-lg font-bold text-gray-800 dark:text-gray-200">
                {isNaN(parsedStatementBalance) ? '—' : formatMoney(parsedStatementBalance)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                LocalBooks Balance
                {statementDate && <span className="ml-1 text-gray-400 dark:text-gray-500">as of {formatDate(statementDate)}</span>}
              </p>
              <p className="text-lg font-bold text-gray-800 dark:text-gray-200">
                {loadingBalance ? '…' : localBooksBalance !== null ? formatMoney(localBooksBalance) : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Difference</p>
              {difference === null ? (
                <p className="text-lg font-bold text-gray-400 dark:text-gray-500">—</p>
              ) : isBalanced ? (
                <p className="text-lg font-bold text-emerald-600 flex items-center justify-center gap-1">
                  <CheckCircle2 className="w-5 h-5" /> $0.00 Balanced!
                </p>
              ) : (
                <p className="text-lg font-bold text-red-600 flex items-center justify-center gap-1">
                  <AlertTriangle className="w-5 h-5" /> {formatMoney(difference)}
                </p>
              )}
            </div>
          </div>

          {difference !== null && !isBalanced && (
            <div className="mt-3 text-sm text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30 rounded p-3">
              <p className="font-semibold mb-1">Possible causes of discrepancy:</p>
              <ul className="list-disc list-inside space-y-0.5 text-xs">
                <li>Transactions in your bank statement not yet entered in LocalBooks</li>
                <li>Transactions entered in LocalBooks but not yet cleared by the bank</li>
                <li>Incorrect transaction amounts — check for typos</li>
                <li>Bank fees or interest not yet recorded</li>
                <li>Transactions checked off that haven&apos;t cleared yet</li>
              </ul>
            </div>
          )}
        </div>

        <button
          onClick={handleReconcile}
          disabled={saving || isNaN(parsedStatementBalance) || !statementDate}
          className={`btn-primary w-full justify-center ${
            isBalanced ? 'bg-emerald-600 hover:bg-emerald-700 border-emerald-600' : ''
          }`}
        >
          {saving ? 'Saving…' : isBalanced
            ? `✓ Reconcile & Mark ${checkedIds.size} Transaction(s) as Cleared`
            : `Save Reconciliation (${checkedIds.size} transaction(s) selected)`
          }
        </button>
      </div>

      {/* Unreconciled transactions */}
      <div className="card overflow-hidden p-0">
        <div className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-500" />
            Unreconciled Transactions
            <span className="text-xs font-normal text-gray-400 dark:text-gray-500">({status.unreconciled_count})</span>
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Check off transactions that appear on your bank statement
          </p>
        </div>

        {status.unreconciled_transactions.length === 0 ? (
          <div className="py-12 text-center text-gray-400 dark:text-gray-500">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-emerald-300" />
            <p>All transactions are reconciled!</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                  <th className="py-2.5 px-4 text-left w-10">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={el => { if (el) el.indeterminate = someChecked; }}
                      onChange={toggleAll}
                      className="rounded text-primary-600 focus:ring-primary-500"
                    />
                  </th>
                  <th className="py-2.5 px-4 text-left text-gray-500 dark:text-gray-400 font-medium w-28">Date</th>
                  <th className="py-2.5 px-4 text-left text-gray-500 dark:text-gray-400 font-medium">Vendor</th>
                  <th className="py-2.5 px-4 text-left text-gray-500 dark:text-gray-400 font-medium">Description</th>
                  <th className="py-2.5 px-4 text-right text-gray-500 dark:text-gray-400 font-medium w-28">Amount</th>
                  <th className="py-2.5 px-4 text-right text-gray-500 dark:text-gray-400 font-medium w-36">Running Balance</th>
                </tr>
              </thead>
              <tbody>
                {status.unreconciled_transactions.map(txn => {
                  const isChecked = checkedIds.has(txn.id);
                  return (
                    <tr
                      key={txn.id}
                      onClick={() => toggleCheck(txn.id)}
                      className={`border-b border-gray-50 dark:border-gray-700 cursor-pointer transition-colors ${
                        isChecked ? 'bg-primary-50/40 dark:bg-primary-900/20 hover:bg-primary-50/60 dark:hover:bg-primary-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      <td className="py-2.5 px-4" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleCheck(txn.id)}
                          className="rounded text-primary-600 focus:ring-primary-500"
                        />
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap text-gray-600 dark:text-gray-400 text-xs">
                        {formatDate(txn.txn_date)}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-gray-800 dark:text-gray-200">
                        {txn.vendor_name || <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                      <td className="py-2.5 px-4 text-gray-500 dark:text-gray-400 max-w-xs truncate" title={txn.description}>
                        {txn.description || <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                      <td className={`py-2.5 px-4 text-right font-semibold whitespace-nowrap ${
                        txn.amount >= 0 ? 'text-emerald-600' : 'text-red-600'
                      }`}>
                        {formatMoney(txn.amount)}
                      </td>
                      <td className="py-2.5 px-4 text-right text-gray-600 dark:text-gray-400 font-medium">
                        {formatMoney(txn.running_balance)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 dark:bg-gray-700/50 border-t-2 border-gray-200 dark:border-gray-600">
                  <td colSpan={4} className="py-3 px-4 text-sm font-semibold text-gray-600 dark:text-gray-400">
                    {checkedIds.size} of {status.unreconciled_transactions.length} selected
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-gray-800 dark:text-gray-200">
                    {formatMoney(checkedSum)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
