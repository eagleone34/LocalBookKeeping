import { useEffect, useState, useCallback } from 'react';
import {
  getDocuments, getDocTransactions, uploadDocuments,
  actionDocTransaction, bulkDocAction, getAccounts,
} from '../api/client';
import {
  Upload, FileText, CheckCircle2, XCircle, AlertCircle,
  Loader2, Check, X, Copy, Building2, CreditCard, ChevronDown, ChevronRight,
} from 'lucide-react';
import GroupedAccountSelect from '../components/GroupedAccountSelect';

function formatMoney(val) {
  if (val === null || val === undefined) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}

function confidenceBadge(conf) {
  const pct = Math.round((conf || 0) * 100);
  if (pct >= 80) return <span className="badge bg-emerald-100 text-emerald-700">{pct}%</span>;
  if (pct >= 50) return <span className="badge bg-amber-100 text-amber-700">{pct}%</span>;
  return <span className="badge bg-red-100 text-red-700">{pct}%</span>;
}

export default function Inbox() {
  const [documents, setDocuments] = useState([]);
  const [docTxns, setDocTxns] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [filter, setFilter] = useState('review');
  const [overrides, setOverrides] = useState({}); // {dtId: accountId}
  const [expandedDocs, setExpandedDocs] = useState(new Set());

  const load = async () => {
    try {
      const [docs, txns, accts] = await Promise.all([
        getDocuments(),
        getDocTransactions(undefined, filter || undefined),
        getAccounts(),
      ]);
      setDocuments(docs);
      setDocTxns(txns);
      setAccounts(accts);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { load(); }, [filter]);

  const handleFiles = async (files) => {
    const pdfs = Array.from(files).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
    if (pdfs.length === 0) return;
    setUploading(true);
    try {
      await uploadDocuments(pdfs);
      await load();
    } catch (e) { console.error(e); }
    setUploading(false);
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, []);

  const handleAction = async (id, action, accountId) => {
    const override = overrides[id];
    await actionDocTransaction(id, { action, account_id: override || accountId || undefined });
    load();
  };

  const handleBulkAction = async (action) => {
    if (selected.size === 0) return;
    await bulkDocAction({ ids: [...selected], action });
    setSelected(new Set());
    load();
  };

  const toggleSelect = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    const reviewTxns = docTxns.filter(t => t.status === 'review');
    if (selected.size === reviewTxns.length) setSelected(new Set());
    else setSelected(new Set(reviewTxns.map(t => t.id)));
  };

  const toggleDoc = (docId) => {
    const next = new Set(expandedDocs);
    next.has(docId) ? next.delete(docId) : next.add(docId);
    setExpandedDocs(next);
  };

  const statusIcon = (status) => {
    switch (status) {
      case 'review': return <AlertCircle className="w-4 h-4 text-amber-500" />;
      case 'posted': return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'rejected': return <XCircle className="w-4 h-4 text-red-500" />;
      case 'approved': return <CheckCircle2 className="w-4 h-4 text-blue-500" />;
      case 'duplicate': return <Copy className="w-4 h-4 text-orange-500" />;
      default: return null;
    }
  };

  // Count stats
  const reviewCount = docTxns.filter(t => t.status === 'review').length;
  const dupCount = docTxns.filter(t => t.is_duplicate).length;
  const postedCount = docTxns.filter(t => t.status === 'posted').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Statement Inbox</h1>
        <p className="text-gray-500 mt-1">Drop PDF bank/credit card statements — transactions extracted and categorized automatically</p>
      </div>

      {/* Drop Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`card border-2 border-dashed text-center py-10 cursor-pointer transition-colors ${
          dragOver ? 'border-primary-400 bg-primary-50' : 'border-gray-300 hover:border-primary-400'
        }`}
        onClick={() => document.getElementById('file-input').click()}
      >
        <input id="file-input" type="file" multiple accept=".pdf" className="hidden" onChange={e => handleFiles(e.target.files)} />
        {uploading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-10 h-10 text-primary-500 animate-spin" />
            <p className="text-gray-600 font-medium">Processing statements... extracting transactions...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="w-10 h-10 text-gray-400" />
            <p className="text-gray-600 font-medium">Drag & drop PDF bank statements here</p>
            <p className="text-gray-400 text-sm">Transactions will be auto-extracted, categorized, and checked for duplicates</p>
          </div>
        )}
      </div>

      {/* Documents with bank info */}
      {documents.length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold mb-3">Uploaded Statements</h3>
          <div className="space-y-2">
            {documents.map(doc => (
              <div key={doc.id} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg text-sm">
                <FileText className="w-4 h-4 text-primary-500 flex-shrink-0" />
                <span className="font-medium">{doc.filename}</span>
                {doc.bank_name && (
                  <span className="flex items-center gap-1 badge bg-blue-100 text-blue-700">
                    <Building2 className="w-3 h-3" />
                    {doc.bank_name}
                  </span>
                )}
                {doc.account_last_four && (
                  <span className="flex items-center gap-1 badge bg-purple-100 text-purple-700">
                    <CreditCard className="w-3 h-3" />
                    ****{doc.account_last_four}
                  </span>
                )}
                {doc.page_count && (
                  <span className="text-gray-400">{doc.page_count} pages</span>
                )}
                <span className={`badge ${
                  doc.status === 'completed' || doc.status === 'review' ? 'bg-emerald-100 text-emerald-700' :
                  doc.status === 'error' ? 'bg-red-100 text-red-700' :
                  doc.status === 'processing' ? 'bg-blue-100 text-blue-700' :
                  'bg-gray-100 text-gray-600'
                }`}>{doc.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats bar */}
      {docTxns.length > 0 && (
        <div className="flex items-center gap-6 text-sm">
          <span className="text-gray-500">{docTxns.length} extracted transactions</span>
          {reviewCount > 0 && <span className="text-amber-600 font-medium">{reviewCount} pending review</span>}
          {dupCount > 0 && <span className="text-orange-600 font-medium">{dupCount} duplicates detected</span>}
          {postedCount > 0 && <span className="text-emerald-600 font-medium">{postedCount} posted</span>}
        </div>
      )}

      {/* Filter & Bulk Actions */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {[
            { key: 'review', label: 'Pending Review' },
            { key: 'duplicate', label: 'Duplicates' },
            { key: 'posted', label: 'Posted' },
            { key: 'rejected', label: 'Rejected' },
            { key: '', label: 'All' },
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === f.key ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {selected.size > 0 && (
          <div className="flex gap-2">
            <span className="text-sm text-gray-500">{selected.size} selected</span>
            <button onClick={() => handleBulkAction('approve')} className="px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-100 text-emerald-700 hover:bg-emerald-200">
              <Check className="w-3 h-3 mr-1 inline" /> Approve All
            </button>
            <button onClick={() => handleBulkAction('reject')} className="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-100 text-red-700 hover:bg-red-200">
              <X className="w-3 h-3 mr-1 inline" /> Reject All
            </button>
          </div>
        )}
      </div>

      {/* Transaction Table */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {(filter === 'review' || filter === '') && (
                  <th className="py-3 px-3 text-left w-10">
                    <input type="checkbox" checked={selected.size > 0 && selected.size === docTxns.filter(t=>t.status==='review').length} onChange={toggleAll} className="rounded text-primary-600" />
                  </th>
                )}
                <th className="py-3 px-3 text-left text-gray-500 font-medium w-10">Status</th>
                <th className="py-3 px-3 text-left text-gray-500 font-medium w-28">Date</th>
                <th className="py-3 px-3 text-left text-gray-500 font-medium">Vendor</th>
                <th className="py-3 px-3 text-left text-gray-500 font-medium">Description</th>
                <th className="py-3 px-3 text-right text-gray-500 font-medium w-28">Amount</th>
                <th className="py-3 px-3 text-left text-gray-500 font-medium w-48">Category</th>
                <th className="py-3 px-3 text-center text-gray-500 font-medium w-16">Conf.</th>
                <th className="py-3 px-3 text-right text-gray-500 font-medium w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {docTxns.map(dt => (
                <tr key={dt.id} className={`border-b border-gray-100 hover:bg-gray-50 ${
                  dt.is_duplicate ? 'bg-orange-50/50' :
                  selected.has(dt.id) ? 'bg-primary-50' : ''
                }`}>
                  {(filter === 'review' || filter === '') && (
                    <td className="py-2 px-3">
                      {dt.status === 'review' && (
                        <input type="checkbox" checked={selected.has(dt.id)} onChange={() => toggleSelect(dt.id)} className="rounded text-primary-600" />
                      )}
                    </td>
                  )}
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-1">
                      {statusIcon(dt.status)}
                      {dt.is_duplicate && (
                        <span className="text-xs text-orange-600 font-medium" title={`Duplicate of transaction #${dt.duplicate_of_txn_id}`}>DUP</span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap text-gray-700">{dt.txn_date || '-'}</td>
                  <td className="py-2 px-3 font-medium text-gray-900">{dt.vendor_name || '-'}</td>
                  <td className="py-2 px-3 text-gray-500 max-w-xs truncate">{dt.description || '-'}</td>
                  <td className={`py-2 px-3 text-right font-medium whitespace-nowrap ${(dt.amount || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatMoney(dt.amount)}
                  </td>
                  <td className="py-2 px-3">
                    {dt.status === 'review' ? (
                      <GroupedAccountSelect
                        accounts={accounts}
                        value={overrides[dt.id] || dt.suggested_account_id || ''}
                        onChange={(e) => setOverrides({...overrides, [dt.id]: parseInt(e.target.value)})}
                        placeholder="Uncategorized"
                        className="input-field text-xs py-1"
                      />
                    ) : (
                      <span className="text-sm">{dt.suggested_account_name || dt.user_account_name || 'Uncategorized'}</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-center">{confidenceBadge(dt.confidence)}</td>
                  <td className="py-2 px-3 text-right">
                    {dt.status === 'review' && (
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => handleAction(dt.id, 'approve', dt.suggested_account_id)}
                          className="p-1.5 rounded-lg hover:bg-emerald-50 text-emerald-600"
                          title="Approve & post"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleAction(dt.id, 'reject')}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-red-500"
                          title="Reject"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                    {dt.status === 'duplicate' && (
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => handleAction(dt.id, 'approve', dt.suggested_account_id)}
                          className="p-1 rounded-lg hover:bg-emerald-50 text-gray-400 hover:text-emerald-600 text-xs"
                          title="Force approve anyway"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleAction(dt.id, 'reject')}
                          className="p-1 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 text-xs"
                          title="Dismiss"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {docTxns.length === 0 && (
          <div className="p-8 text-center text-gray-400">
            {filter === 'review' ? 'No transactions pending review. Upload a PDF statement to get started.' : 'No transactions found.'}
          </div>
        )}
      </div>
    </div>
  );
}
