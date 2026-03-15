import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  getDocuments, getDocTransactions, uploadDocuments,
  actionDocTransaction, bulkDocAction, getAccounts,
  deleteDocument, deleteDocTransaction, getBankAccounts,
} from '../api/client';
import {
  Upload, FileText, CheckCircle2, XCircle, AlertCircle,
  Loader2, Check, X, Copy, Building2, CreditCard, ChevronDown, ChevronRight,
  FolderOpen, RotateCcw, Trash2, FileSpreadsheet
} from 'lucide-react';
import GroupedAccountSelect from '../components/GroupedAccountSelect';
import ImportWizard from '../components/ImportWizard';

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
  const [bankAccounts, setBankAccounts] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  
  // selected transaction IDs
  const [selected, setSelected] = useState(new Set());
  const [filter, setFilter] = useState('review');
  const [overrides, setOverrides] = useState({}); // {dtId: accountId}
  const [confirmingDelete, setConfirmingDelete] = useState(null); // { type: 'txn' | 'doc', id: any }
  const [showImportWizard, setShowImportWizard] = useState(false);

  const load = async () => {
    try {
      const [docs, txns, accts, ba] = await Promise.all([
        getDocuments(),
        getDocTransactions(undefined, filter || undefined),
        getAccounts(),
        getBankAccounts(),
      ]);
      setDocuments(docs);
      setDocTxns(txns);
      setAccounts(accts);
      setBankAccounts(ba);
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

  const handleAction = async (id, action, categoryId) => {
    const finalCategoryId = overrides[id] || categoryId;
    if (action === 'approve' && !finalCategoryId) {
      alert("Cannot approve transaction without a selected category. Please categorize it first.");
      return;
    }

    try {
      await actionDocTransaction(id, { action, category_id: finalCategoryId || undefined });
      load();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to process transaction.');
    }
  };

  const handleBulkAction = async (docId, action) => {
    // get all selected txns that belong to this doc
    const txnsToProcess = docTxns
      .filter(t => t.document_id === docId && selected.has(t.id));
      
    if (txnsToProcess.length === 0) return;

    if (action === 'approve') {
      // Validate categories exist for approvals
      const missingCategories = txnsToProcess.filter(t => !(overrides[t.id] || t.suggested_category_id || t.suggested_account_id));
      if (missingCategories.length > 0) {
        alert(`Cannot approve. ${missingCategories.length} selected transaction(s) are missing a category. Please categorize them first.`);
        return;
      }
    }

    try {
      // Process each transaction individually so overrides are sent correctly
      let failed = 0;
      for (const t of txnsToProcess) {
        const categoryId = overrides[t.id] || t.suggested_category_id || t.suggested_account_id;
        try {
          await actionDocTransaction(t.id, { action, category_id: categoryId || undefined });
        } catch (err) {
          console.error(`Failed to ${action} transaction ${t.id}:`, err);
          failed++;
        }
      }
      if (failed > 0) {
        alert(`${txnsToProcess.length - failed} processed successfully, ${failed} failed.`);
      }
      load();
    } catch (err) {
      console.error(err);
      alert('Bulk action failed.');
    }
  };

  const handleDeleteTransaction = async (id) => {
    try {
      await deleteDocTransaction(id);
      setConfirmingDelete(null);
      load();
    } catch (err) {
      console.error(err);
      alert('Failed to delete transaction.');
    }
  };

  const handleDeleteDocument = async (docId) => {
    try {
      await deleteDocument(docId);
      setConfirmingDelete(null);
      load();
    } catch (err) {
      console.error(err);
      alert('Failed to delete statement.');
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
        <h1 className="text-2xl font-bold text-gray-900">Statements</h1>
        <p className="text-gray-500 mt-1">Drop PDF statements or import spreadsheet files to auto-extract and categorize transactions</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
        {/* Drop Zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`card border-2 border-dashed text-center py-10 cursor-pointer transition-colors h-full flex flex-col justify-center ${
            dragOver ? 'border-primary-400 bg-primary-50' : 'border-gray-300 hover:border-primary-400'
          }`}
          onClick={() => document.getElementById('file-input').click()}
        >
          <input id="file-input" type="file" multiple accept=".pdf" className="hidden" onChange={e => handleFiles(e.target.files)} />
          {uploading ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-10 h-10 text-primary-500 animate-spin" />
              <p className="text-gray-600 font-medium">Processing statements...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="w-10 h-10 text-gray-400" />
              <p className="text-gray-600 font-medium text-lg">Import PDF Statements</p>
              <p className="text-gray-400 text-sm max-w-[250px] mx-auto">Drag & drop PDF bank statements here. Auto-categorized and checked for duplicates.</p>
            </div>
          )}
        </div>

        {/* CSV / Excel generic manual import */}
        <div 
          onClick={() => setShowImportWizard(true)} 
          className="card border-2 border-dashed border-gray-300 hover:border-emerald-400 text-center py-10 cursor-pointer transition-colors hover:bg-emerald-50 h-full flex flex-col justify-center"
        >
          <div className="flex flex-col items-center gap-2">
            <FileSpreadsheet className="w-10 h-10 text-emerald-500 mb-1" />
            <p className="text-gray-600 font-medium text-lg">Import Spreadsheet</p>
            <p className="text-gray-400 text-sm max-w-[250px] mx-auto">Upload a .csv, .xls, or .xlsx file to map columns and import bulk transactions.</p>
          </div>
        </div>
      </div>

      {showImportWizard && (
        <ImportWizard 
          onClose={() => setShowImportWizard(false)}
          accounts={accounts}
          onSuccess={() => {
            setShowImportWizard(false);
            load();
          }}
        />
      )}

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

                  <div className="flex items-center gap-3">
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

                    <div className="flex items-center gap-2">
                      {confirmingDelete?.type === 'doc' && confirmingDelete?.id === doc.id ? (
                        <div className="flex items-center gap-2 bg-red-50 px-2 py-1 rounded-md border border-red-100 animate-in fade-in slide-in-from-right-2">
                          <span className="text-xs font-bold text-red-700">Delete Statement?</span>
                          <button 
                            onClick={() => handleDeleteDocument(doc.id)}
                            className="p-1 rounded hover:bg-red-200 text-red-700 transition-colors"
                            title="Confirm Delete"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => setConfirmingDelete(null)}
                            className="p-1 rounded hover:bg-gray-200 text-gray-500 transition-colors"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <button 
                          onClick={() => setConfirmingDelete({ type: 'doc', id: doc.id })}
                          className="p-2 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors flex items-center gap-1 text-sm font-medium"
                          title="Delete entire statement and all its transactions"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span className="hidden sm:inline">Delete Statement</span>
                        </button>
                      )}
                    </div>
                  </div>
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
                        <th className="py-2.5 px-3 text-left text-gray-500 font-medium w-40">Account</th>
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
                            {dt.bank_account_name ? (
                              <span className="text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                                {dt.bank_account_name}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">-</span>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            {dt.status === 'review' ? (
                              <GroupedAccountSelect
                                accounts={accounts}
                                value={overrides[dt.id] || dt.suggested_category_id || dt.suggested_account_id || ''}
                                onChange={(e) => setOverrides({...overrides, [dt.id]: parseInt(e.target.value)})}
                                placeholder="Uncategorized"
                                className="input-field text-xs py-1"
                              />
                            ) : (
                              <span className="text-sm font-medium text-gray-600">
                                {dt.suggested_category_name || dt.user_category_name || dt.suggested_account_name || dt.user_account_name || 'Uncategorized'}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-center">{confidenceBadge(dt.confidence)}</td>
                          <td className="py-2 px-3 text-right">
                            {dt.status === 'review' && (
                               <div className="flex justify-end gap-1">
                                 {confirmingDelete?.type === 'txn' && confirmingDelete?.id === dt.id ? (
                                   <div className="flex items-center gap-1 bg-red-50 px-1 rounded border border-red-100 animate-in fade-in zoom-in-95">
                                     <span className="text-[10px] font-bold text-red-700 px-1">Sure?</span>
                                     <button onClick={() => handleDeleteTransaction(dt.id)} className="p-1 text-red-600 hover:bg-red-100 rounded" title="Confirm Delete"><Check className="w-3 h-3" /></button>
                                     <button onClick={() => setConfirmingDelete(null)} className="p-1 text-gray-400 hover:bg-gray-100 rounded" title="Cancel"><X className="w-3 h-3" /></button>
                                   </div>
                                 ) : (
                                   <>
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
                                     <button
                                       onClick={() => setConfirmingDelete({ type: 'txn', id: dt.id })}
                                       className="p-1.5 rounded-md hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                                       title="Delete from inbox"
                                     >
                                       <Trash2 className="w-4 h-4" />
                                     </button>
                                   </>
                                 )}
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
                                <button
                                  onClick={() => handleAction(dt.id, 'revert')}
                                  className="p-1.5 rounded-md hover:bg-amber-100 text-gray-400 hover:text-amber-600 transition-colors"
                                  title="Move back to review"
                                >
                                  <RotateCcw className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                            {dt.status === 'posted' && (
                               <div className="flex justify-end gap-1">
                                 {confirmingDelete?.type === 'revert' && confirmingDelete?.id === dt.id ? (
                                   <div className="flex items-center gap-1 bg-amber-50 px-1 rounded border border-amber-100 animate-in fade-in zoom-in-95">
                                     <span className="text-[10px] font-bold text-amber-700 px-1">Undo Post?</span>
                                     <button onClick={() => { handleAction(dt.id, 'revert'); setConfirmingDelete(null); }} className="p-1 text-amber-600 hover:bg-amber-100 rounded" title="Confirm Undo"><Check className="w-3 h-3" /></button>
                                     <button onClick={() => setConfirmingDelete(null)} className="p-1 text-gray-400 hover:bg-gray-100 rounded" title="Cancel"><X className="w-3 h-3" /></button>
                                   </div>
                                 ) : (
                                   <button
                                     onClick={() => setConfirmingDelete({ type: 'revert', id: dt.id })}
                                     className="p-1.5 rounded-md hover:bg-amber-100 text-gray-400 hover:text-amber-600 transition-colors"
                                     title="Undo post — removes ledger entry and returns to review"
                                   >
                                     <RotateCcw className="w-4 h-4" />
                                   </button>
                                 )}
                               </div>
                             )}
                            {dt.status === 'rejected' && (
                              <div className="flex justify-end gap-1">
                                <button
                                  onClick={() => handleAction(dt.id, 'revert')}
                                  className="p-1.5 rounded-md hover:bg-amber-100 text-gray-400 hover:text-amber-600 transition-colors"
                                  title="Move back to review"
                                >
                                  <RotateCcw className="w-4 h-4" />
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
