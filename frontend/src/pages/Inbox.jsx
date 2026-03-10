import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  getDocuments, getDocTransactions, uploadDocuments,
  actionDocTransaction, bulkDocAction, getAccounts,
} from '../api/client';
import {
  Upload, FileText, CheckCircle2, XCircle, AlertCircle,
  Loader2, Check, X, Copy, Building2, CreditCard, ChevronDown, ChevronRight,
  FolderOpen
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
  
  // selected transaction IDs
  const [selected, setSelected] = useState(new Set());
  const [filter, setFilter] = useState('review');
  const [overrides, setOverrides] = useState({}); // {dtId: accountId}

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
      setSelected(new Set());
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
    } catch (e) {
      console.error(e);
      alert('Failed to upload file(s).');
    }
    setUploading(false);
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, []);

  const handleAction = async (id, action, accountId) => {
    const finalAccountId = overrides[id] || accountId;
    if (action === 'approve' && !finalAccountId) {
      alert("Cannot approve transaction without a selected account category. Please categorize it first.");
      return;
    }

    try {
      await actionDocTransaction(id, { action, account_id: finalAccountId || undefined });
      load();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to process transaction.');
    }
  };

  const handleBulkAction = async (docId, action) => {
    // get all selected txns that belong to this doc
    const idsToProcess = docTxns
      .filter(t => t.document_id === docId && selected.has(t.id))
      .map(t => t.id);
      
    if (idsToProcess.length === 0) return;

    if (action === 'approve') {
      // Validate categories exist for approvals
      const missingAccounts = docTxns.filter(t => idsToProcess.includes(t.id) && !(overrides[t.id] || t.suggested_account_id));
      if (missingAccounts.length > 0) {
        alert("Cannot approve. One or more selected transactions are missing an account category.");
        return;
      }
    }

    try {
      await bulkDocAction({ ids: idsToProcess, action });
      load();
    } catch (err) {
      console.error(err);
      alert('Bulk action failed.');
    }
  };

  const toggleSelect = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const toggleAllInDoc = (docId) => {
    const docReviewTxns = docTxns.filter(t => t.document_id === docId && t.status === 'review');
    const allSelected = docReviewTxns.every(t => selected.has(t.id));

    const next = new Set(selected);
    if (allSelected) {
      // deselect all in doc
      docReviewTxns.forEach(t => next.delete(t.id));
    } else {
      // select all in doc
      docReviewTxns.forEach(t => next.add(t.id));
    }
    setSelected(next);
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

  // Group Txns by Document
  const groupedTxns = useMemo(() => {
    const groups = {};
    docTxns.forEach(t => {
      if (!groups[t.document_id]) groups[t.document_id] = [];
      groups[t.document_id].push(t);
    });
    return groups;
  }, [docTxns]);

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

      {/* Processing Status for non-completed docs */}
      {documents.filter(d => ['pending', 'processing', 'error'].includes(d.status)).length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold mb-3">Processing Queue</h3>
          <div className="space-y-2">
            {documents.filter(d => ['pending', 'processing', 'error'].includes(d.status)).map(doc => (
              <div key={doc.id} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg text-sm">
                <FileText className="w-4 h-4 text-primary-500 flex-shrink-0" />
                <span className="font-medium">{doc.filename}</span>
                <span className={`badge ${
                  doc.status === 'error' ? 'bg-red-100 text-red-700' :
                  doc.status === 'processing' ? 'bg-blue-100 text-blue-700 animate-pulse' :
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

      {/* Filter Tabs */}
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

      {/* Grouped Documents Rendering */}
      {documents.filter(d => groupedTxns[d.id] && groupedTxns[d.id].length > 0).length === 0 ? (
        <div className="card p-8 text-center text-gray-400 flex flex-col items-center">
            <FolderOpen className="w-12 h-12 text-gray-300 mb-2" />
            <p>{filter === 'review' ? 'No transactions pending review in any statement.' : 'No transactions found.'}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {documents.map(doc => {
            const txns = groupedTxns[doc.id];
            if (!txns || txns.length === 0) return null;

            const docSelectedCount = txns.filter(t => selected.has(t.id)).length;
            const docReviewCount = txns.filter(t => t.status === 'review').length;
            const allSelected = docSelectedCount > 0 && docSelectedCount === docReviewCount;
            
            return (
              <div key={doc.id} className="card overflow-hidden p-0 border border-gray-200">
                
                {/* Document Header with bulk actions */}
                <div className="bg-gray-50 border-b border-gray-200 p-4 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-white rounded shadow-sm border border-gray-100">
                      <FileText className="w-5 h-5 text-primary-600" />
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-900">{doc.filename}</h3>
                      <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-gray-500">
                        {doc.bank_name && (
                          <span className="flex items-center gap-1 font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                            <Building2 className="w-3 h-3" />
                            {doc.bank_name}
                          </span>
                        )}
                        {doc.account_last_four && (
                          <span className="flex items-center gap-1 font-medium text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-100">
                            <CreditCard className="w-3 h-3" />
                            ****{doc.account_last_four}
                          </span>
                        )}
                        <span>{txns.length} records</span>
                      </div>
                    </div>
                  </div>

                  {/* Contextual Bulk Actions */}
                  {docSelectedCount > 0 && (
                    <div className="flex items-center gap-2 bg-white p-1 rounded-lg shadow-sm border border-gray-200">
                      <span className="text-sm font-medium text-gray-600 px-3 border-r border-gray-200">
                        {docSelectedCount} selected
                      </span>
                      <button onClick={() => handleBulkAction(doc.id, 'approve')} className="px-3 py-1.5 rounded-md text-sm font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" /> Approve
                      </button>
                      <button onClick={() => handleBulkAction(doc.id, 'reject')} className="px-3 py-1.5 rounded-md text-sm font-medium bg-red-50 text-red-700 hover:bg-red-100 transition-colors flex items-center gap-1">
                        <X className="w-3.5 h-3.5" /> Reject
                      </button>
                    </div>
                  )}
                </div>

                {/* Document Transactions Table */}
                <div className="overflow-x-auto bg-white">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white border-b border-gray-100">
                        {(filter === 'review' || filter === '') && (
                          <th className="py-2.5 px-3 text-left w-10">
                            <input type="checkbox" checked={allSelected} onChange={() => toggleAllInDoc(doc.id)} className="rounded text-primary-600 focus:ring-primary-500" />
                          </th>
                        )}
                        <th className="py-2.5 px-3 text-left text-gray-500 font-medium w-10">Status</th>
                        <th className="py-2.5 px-3 text-left text-gray-500 font-medium w-28">Date</th>
                        <th className="py-2.5 px-3 text-left text-gray-500 font-medium">Vendor</th>
                        <th className="py-2.5 px-3 text-left text-gray-500 font-medium">Description</th>
                        <th className="py-2.5 px-3 text-right text-gray-500 font-medium w-28">Amount</th>
                        <th className="py-2.5 px-3 text-left text-gray-500 font-medium w-48">Category</th>
                        <th className="py-2.5 px-3 text-center text-gray-500 font-medium w-16">Conf.</th>
                        <th className="py-2.5 px-3 text-right text-gray-500 font-medium w-24">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {txns.map(dt => (
                        <tr key={dt.id} className={`border-b border-gray-50 transition-colors hover:bg-gray-50/50 ${
                          dt.is_duplicate ? 'bg-orange-50/30' :
                          selected.has(dt.id) ? 'bg-primary-50/50' : ''
                        }`}>
                          {(filter === 'review' || filter === '') && (
                            <td className="py-2 px-3">
                              {dt.status === 'review' && (
                                <input type="checkbox" checked={selected.has(dt.id)} onChange={() => toggleSelect(dt.id)} className="rounded text-primary-600 focus:ring-primary-500" />
                              )}
                            </td>
                          )}
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-1">
                              {statusIcon(dt.status)}
                              {dt.is_duplicate && (
                                <span className="text-xs text-orange-600 font-medium bg-orange-100 px-1 rounded" title={`Duplicate of transaction #${dt.duplicate_of_txn_id}`}>DUP</span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap text-gray-600">{dt.txn_date || '-'}</td>
                          <td className="py-2 px-3 font-medium text-gray-800">{dt.vendor_name || '-'}</td>
                          <td className="py-2 px-3 text-gray-500 max-w-xs truncate" title={dt.description}>{dt.description || '-'}</td>
                          <td className={`py-2 px-3 text-right font-semibold whitespace-nowrap ${(dt.amount || 0) >= 0 ? 'text-emerald-600' : 'text-gray-900'}`}>
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
                              <span className="text-sm font-medium text-gray-600">{dt.suggested_account_name || dt.user_account_name || 'Uncategorized'}</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-center">{confidenceBadge(dt.confidence)}</td>
                          <td className="py-2 px-3 text-right">
                            {dt.status === 'review' && (
                              <div className="flex justify-end gap-1">
                                <button
                                  onClick={() => handleAction(dt.id, 'approve', dt.suggested_account_id)}
                                  className="p-1.5 rounded-md hover:bg-emerald-100 text-emerald-600 transition-colors"
                                  title="Approve & post"
                                >
                                  <CheckCircle2 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleAction(dt.id, 'reject')}
                                  className="p-1.5 rounded-md hover:bg-red-100 text-red-500 transition-colors"
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
                                  className="p-1.5 rounded-md hover:bg-emerald-100 text-gray-400 hover:text-emerald-600 transition-colors"
                                  title="Force approve anyway"
                                >
                                  <CheckCircle2 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleAction(dt.id, 'reject')}
                                  className="p-1.5 rounded-md hover:bg-red-100 text-gray-400 hover:text-red-500 transition-colors"
                                  title="Dismiss"
                                >
                                  <XCircle className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
