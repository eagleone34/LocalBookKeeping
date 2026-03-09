import { useEffect, useState, useCallback } from 'react';
import { getDocuments, getDocTransactions, uploadDocuments, actionDocTransaction, bulkDocAction, getAccounts } from '../api/client';
import { Upload, FileText, CheckCircle2, XCircle, AlertCircle, Loader2, Check, X } from 'lucide-react';

function formatMoney(val) {
  if (val === null || val === undefined) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
}

function confidenceBadge(conf) {
  const pct = Math.round((conf || 0) * 100);
  if (pct >= 80) return <span className="badge bg-emerald-100 text-emerald-700">{pct}% match</span>;
  if (pct >= 50) return <span className="badge bg-amber-100 text-amber-700">{pct}% match</span>;
  return <span className="badge bg-red-100 text-red-700">{pct}% match</span>;
}

export default function Inbox() {
  const [documents, setDocuments] = useState([]);
  const [docTxns, setDocTxns] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [filter, setFilter] = useState('review');

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
      load();
    } catch (e) { console.error(e); }
    setUploading(false);
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, []);

  const handleAction = async (id, action, accountId) => {
    await actionDocTransaction(id, { action, account_id: accountId || undefined });
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
    if (selected.size === docTxns.length) setSelected(new Set());
    else setSelected(new Set(docTxns.map(t => t.id)));
  };

  const statusIcon = (status) => {
    switch (status) {
      case 'review': return <AlertCircle className="w-4 h-4 text-amber-500" />;
      case 'posted': return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'rejected': return <XCircle className="w-4 h-4 text-red-500" />;
      case 'approved': return <CheckCircle2 className="w-4 h-4 text-blue-500" />;
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Statement Inbox</h1>
        <p className="text-gray-500 mt-1">Upload PDF bank/credit card statements for automatic extraction</p>
      </div>

      {/* Drop Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`card border-2 border-dashed text-center py-12 cursor-pointer transition-colors ${
          dragOver ? 'border-primary-400 bg-primary-50' : 'border-gray-300 hover:border-primary-400'
        }`}
        onClick={() => document.getElementById('file-input').click()}
      >
        <input id="file-input" type="file" multiple accept=".pdf" className="hidden" onChange={e => handleFiles(e.target.files)} />
        {uploading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-12 h-12 text-primary-500 animate-spin" />
            <p className="text-gray-600 font-medium">Processing statements...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Upload className="w-12 h-12 text-gray-400" />
            <div>
              <p className="text-gray-600 font-medium">Drag & drop PDF statements here</p>
              <p className="text-gray-400 text-sm mt-1">or click to browse files</p>
            </div>
          </div>
        )}
      </div>

      {/* Documents List */}
      {documents.length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold mb-3">Uploaded Documents</h3>
          <div className="flex flex-wrap gap-3">
            {documents.map(doc => (
              <div key={doc.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg text-sm">
                <FileText className="w-4 h-4 text-primary-500" />
                <span className="font-medium">{doc.filename}</span>
                <span className={`badge ${
                  doc.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                  doc.status === 'review' ? 'bg-amber-100 text-amber-700' :
                  doc.status === 'error' ? 'bg-red-100 text-red-700' :
                  'bg-gray-100 text-gray-600'
                }`}>{doc.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter & Bulk Actions */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {['review', 'posted', 'rejected', ''].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === f ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f || 'All'}
            </button>
          ))}
        </div>
        {selected.size > 0 && filter === 'review' && (
          <div className="flex gap-2">
            <span className="text-sm text-gray-500">{selected.size} selected</span>
            <button onClick={() => handleBulkAction('approve')} className="btn-success btn-sm">
              <Check className="w-3 h-3 mr-1" /> Approve All
            </button>
            <button onClick={() => handleBulkAction('reject')} className="btn-danger btn-sm">
              <X className="w-3 h-3 mr-1" /> Reject All
            </button>
          </div>
        )}
      </div>

      {/* Extracted Transactions */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {filter === 'review' && (
                  <th className="py-3 px-4 text-left">
                    <input type="checkbox" checked={selected.size === docTxns.length && docTxns.length > 0} onChange={toggleAll} className="rounded text-primary-600" />
                  </th>
                )}
                <th className="py-3 px-4 text-left text-gray-500 font-medium">Status</th>
                <th className="py-3 px-4 text-left text-gray-500 font-medium">Date</th>
                <th className="py-3 px-4 text-left text-gray-500 font-medium">Vendor</th>
                <th className="py-3 px-4 text-left text-gray-500 font-medium">Description</th>
                <th className="py-3 px-4 text-right text-gray-500 font-medium">Amount</th>
                <th className="py-3 px-4 text-left text-gray-500 font-medium">Suggested Category</th>
                <th className="py-3 px-4 text-center text-gray-500 font-medium">Confidence</th>
                {filter === 'review' && <th className="py-3 px-4 text-right text-gray-500 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {docTxns.map(dt => (
                <tr key={dt.id} className={`border-b border-gray-100 hover:bg-gray-50 ${selected.has(dt.id) ? 'bg-primary-50' : ''}`}>
                  {filter === 'review' && (
                    <td className="py-3 px-4">
                      <input type="checkbox" checked={selected.has(dt.id)} onChange={() => toggleSelect(dt.id)} className="rounded text-primary-600" />
                    </td>
                  )}
                  <td className="py-3 px-4">{statusIcon(dt.status)}</td>
                  <td className="py-3 px-4 whitespace-nowrap">{dt.txn_date || '-'}</td>
                  <td className="py-3 px-4 font-medium">{dt.vendor_name || '-'}</td>
                  <td className="py-3 px-4 text-gray-500 max-w-xs truncate">{dt.description || '-'}</td>
                  <td className={`py-3 px-4 text-right font-medium whitespace-nowrap ${(dt.amount || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatMoney(dt.amount)}
                  </td>
                  <td className="py-3 px-4">
                    {filter === 'review' ? (
                      <select
                        defaultValue={dt.suggested_account_id || ''}
                        onChange={(e) => {
                          // Store override locally - will be used on approve
                          dt._override_account = parseInt(e.target.value);
                        }}
                        className="input-field text-xs py-1"
                      >
                        <option value="">Uncategorized</option>
                        {accounts.map(a => (
                          <option key={a.id} value={a.id}>{a.name} ({a.type})</option>
                        ))}
                      </select>
                    ) : (
                      <span>{dt.suggested_account_name || dt.user_account_name || 'Uncategorized'}</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center">{confidenceBadge(dt.confidence)}</td>
                  {filter === 'review' && (
                    <td className="py-3 px-4 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => handleAction(dt.id, 'approve', dt._override_account || dt.suggested_account_id)}
                          className="p-1.5 rounded-lg hover:bg-emerald-50 text-emerald-600"
                          title="Approve"
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
                    </td>
                  )}
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
