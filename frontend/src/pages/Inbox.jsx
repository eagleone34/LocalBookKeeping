import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  getDocuments, getDocTransactions, uploadDocuments,
  actionDocTransaction, bulkDocAction, getAccounts,
  deleteDocument, deleteDocTransaction, getBankAccounts,
  suggestCategories,
} from '../api/client';
import {
  Upload, FileText, CheckCircle2, XCircle, AlertCircle,
  Loader2, Check, X, Copy, Building2, CreditCard, ChevronDown, ChevronRight,
  FolderOpen, RotateCcw, Trash2, FileSpreadsheet, Search, Filter, Tag
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
  if (pct > 0) return <span className="badge bg-red-100 text-red-700">{pct}%</span>;
  return <span className="badge bg-gray-100 text-gray-500">—</span>;
}

// Confidence color helpers (adapted from ImportWizard)
function confidenceColor(confidence) {
  if (confidence >= 80) return 'text-emerald-600';
  if (confidence >= 50) return 'text-amber-600';
  return 'text-red-500';
}
function confidenceBg(confidence) {
  if (confidence >= 80) return 'bg-emerald-50 border-emerald-200';
  if (confidence >= 50) return 'bg-amber-50 border-amber-200';
  return 'bg-red-50 border-red-200';
}
function confidenceDot(confidence) {
  if (confidence >= 80) return 'bg-emerald-400';
  if (confidence >= 50) return 'bg-amber-400';
  return 'bg-red-400';
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

  // Per-document search/filter state: { [docId]: { search, amountOp, amountVal, amountMin, amountMax, categoryId } }
  const [docFilters, setDocFilters] = useState({});
  // Bulk category selection for the floating bar
  const [bulkCategoryId, setBulkCategoryId] = useState('');

  // Smart grouping state
  const [smartGroups, setSmartGroups] = useState({});        // { docId: { groups: [], ungrouped: [] } }
  const [expandedGroups, setExpandedGroups] = useState(new Set()); // "docId:groupIdx" format
  const [groupingLoading, setGroupingLoading] = useState({}); // { docId: boolean }

  const getDocFilter = useCallback((docId) => {
    return docFilters[docId] || { search: '', amountOp: 'any', amountVal: '', amountMin: '', amountMax: '', categoryId: '' };
  }, [docFilters]);

  const updateDocFilter = useCallback((docId, field, value) => {
    setDocFilters(prev => ({
      ...prev,
      [docId]: { ...(prev[docId] || { search: '', amountOp: 'any', amountVal: '', amountMin: '', amountMax: '', categoryId: '' }), [field]: value }
    }));
  }, []);

  const clearDocFilter = useCallback((docId) => {
    setDocFilters(prev => {
      const next = { ...prev };
      delete next[docId];
      return next;
    });
  }, []);

  const isDocFilterActive = useCallback((docId) => {
    const f = getDocFilter(docId);
    return f.search || (f.amountOp && f.amountOp !== 'any') || f.categoryId;
  }, [getDocFilter]);

  const applyDocFilters = useCallback((txns, docId) => {
    const f = getDocFilter(docId);
    let result = txns;

    // Text search on description or vendor_name
    if (f.search) {
      const term = f.search.toLowerCase();
      result = result.filter(t =>
        (t.description || '').toLowerCase().includes(term) ||
        (t.vendor_name || '').toLowerCase().includes(term)
      );
    }

    // Amount filter
    if (f.amountOp && f.amountOp !== 'any') {
      const val = parseFloat(f.amountVal);
      const min = parseFloat(f.amountMin);
      const max = parseFloat(f.amountMax);

      result = result.filter(t => {
        const amt = Math.abs(t.amount || 0);
        switch (f.amountOp) {
          case 'eq': return !isNaN(val) && Math.abs(amt - val) < 0.005;
          case 'gt': return !isNaN(val) && amt > val;
          case 'lt': return !isNaN(val) && amt < val;
          case 'gte': return !isNaN(val) && amt >= val;
          case 'lte': return !isNaN(val) && amt <= val;
          case 'between': return !isNaN(min) && !isNaN(max) && amt >= min && amt <= max;
          default: return true;
        }
      });
    }

    // Category filter
    if (f.categoryId) {
      const catId = parseInt(f.categoryId);
      result = result.filter(t => {
        const effectiveCat = overrides[t.id] || t.suggested_category_id || t.suggested_account_id;
        return effectiveCat === catId;
      });
    }

    return result;
  }, [getDocFilter, overrides]);

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
      // Filter accounts to only include expense and income for Category dropdown
      // Asset and liability accounts are bank accounts, not categories
      const categoryAccounts = accts.filter(a => a.type === 'expense' || a.type === 'income');
      setAccounts(categoryAccounts);
      setBankAccounts(ba);
      setSelected(new Set());
    } catch (e) { console.error(e); }
  };

  useEffect(() => { load(); }, [filter]);

  // Fetch smart groups for documents with review transactions
  useEffect(() => {
    if (filter !== 'review' || docTxns.length === 0 || documents.length === 0) return;

    const fetchGroups = async () => {
      // Group txns by doc
      const txnsByDoc = {};
      docTxns.forEach(t => {
        if (!txnsByDoc[t.document_id]) txnsByDoc[t.document_id] = [];
        txnsByDoc[t.document_id].push(t);
      });

      for (const doc of documents) {
        const reviewTxns = (txnsByDoc[doc.id] || []).filter(t => t.status === 'review');
        if (reviewTxns.length < 2) {
          // Not enough transactions to group — treat all as ungrouped
          if (reviewTxns.length > 0) {
            setSmartGroups(prev => ({ ...prev, [doc.id]: { groups: [], ungrouped: reviewTxns } }));
          }
          continue;
        }
        // Skip if we already have groups for this doc (avoid refetching on every render)
        if (smartGroups[doc.id]) continue;

        setGroupingLoading(prev => ({ ...prev, [doc.id]: true }));
        try {
          const payload = {
            transactions: reviewTxns.map(t => ({
              description: t.description,
              amount: t.amount,
              date: t.txn_date,
            })),
            bank_account_id: doc.bank_account_id || null,
          };
          const result = await suggestCategories(payload);
          const groups = Array.isArray(result.groups) ? result.groups : [];
          const groupsWithIds = groups.map(g => ({
            ...g,
            transaction_ids: (g.transaction_indices || []).map(idx => reviewTxns[idx]?.id).filter(Boolean),
            transactions: (g.transaction_indices || []).map(idx => reviewTxns[idx]).filter(Boolean),
          }));
          const ungroupedTxns = (Array.isArray(result.ungrouped_indices) ? result.ungrouped_indices : [])
            .map(idx => reviewTxns[idx]).filter(Boolean);

          // Pre-populate overrides from suggestions
          const newOverrides = {};
          for (const group of groupsWithIds) {
            if (group.suggested_category_id) {
              for (const id of group.transaction_ids) {
                // Only set if no existing override
                if (!overrides[id]) {
                  newOverrides[id] = group.suggested_category_id;
                }
              }
            }
          }
          if (Object.keys(newOverrides).length > 0) {
            setOverrides(prev => ({ ...prev, ...newOverrides }));
          }

          setSmartGroups(prev => ({ ...prev, [doc.id]: { groups: groupsWithIds, ungrouped: ungroupedTxns } }));
        } catch (err) {
          console.error(`Smart grouping failed for doc ${doc.id}:`, err);
          // Fallback: all as ungrouped
          setSmartGroups(prev => ({ ...prev, [doc.id]: { groups: [], ungrouped: reviewTxns } }));
        } finally {
          setGroupingLoading(prev => ({ ...prev, [doc.id]: false }));
        }
      }
    };

    fetchGroups();
  }, [filter, docTxns, documents]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFiles = async (files) => {
    const pdfs = Array.from(files).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
    if (pdfs.length === 0) return;
    setUploading(true);
    try {
      await uploadDocuments(pdfs);
      setSmartGroups({}); // Reset groups on new upload
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
      setSmartGroups({}); // Reset groups after action
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
      setSmartGroups({}); // Reset groups after bulk action
      load();
    } catch (err) {
      console.error(err);
      alert('Bulk action failed.');
    }
  };

  // Global bulk actions (across all documents)
  const handleGlobalBulkAction = async (action) => {
    const txnsToProcess = docTxns.filter(t => selected.has(t.id));
    if (txnsToProcess.length === 0) return;

    if (action === 'approve') {
      const missingCategories = txnsToProcess.filter(t => !(overrides[t.id] || t.suggested_category_id || t.suggested_account_id));
      if (missingCategories.length > 0) {
        alert(`Cannot approve. ${missingCategories.length} selected transaction(s) are missing a category. Please categorize them first.`);
        return;
      }
    }

    try {
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
      setSmartGroups({}); // Reset groups after bulk action
      load();
    } catch (err) {
      console.error(err);
      alert('Bulk action failed.');
    }
  };

  const handleBulkSetCategory = useCallback((categoryId) => {
    if (!categoryId) return;
    const catId = parseInt(categoryId);
    const newOverrides = { ...overrides };
    selected.forEach(id => {
      newOverrides[id] = catId;
    });
    setOverrides(newOverrides);
    setBulkCategoryId('');
  }, [overrides, selected]);

  const handleDeleteTransaction = async (id) => {
    try {
      await deleteDocTransaction(id);
      setConfirmingDelete(null);
      setSmartGroups({}); // Reset groups after delete
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
      setSmartGroups({}); // Reset groups after delete
      load();
    } catch (err) {
      console.error(err);
      alert('Failed to delete statement.');
    }
  };

  // ── Smart Group Handlers ──

  // When user changes category on a group header, apply to all transactions in that group
  const handleGroupCategoryChange = (docId, groupIdx, newCategoryId) => {
    const docGroups = smartGroups[docId];
    if (!docGroups) return;
    const group = docGroups.groups[groupIdx];
    if (!group) return;
    const catId = newCategoryId ? parseInt(newCategoryId, 10) : null;
    const newOverrides = { ...overrides };
    group.transaction_ids.forEach(id => {
      if (catId) {
        newOverrides[id] = catId;
      } else {
        delete newOverrides[id];
      }
    });
    setOverrides(newOverrides);

    // Update the group's suggested category for display
    setSmartGroups(prev => {
      const updated = { ...prev };
      const docData = { ...updated[docId] };
      const updatedGroups = [...docData.groups];
      updatedGroups[groupIdx] = {
        ...updatedGroups[groupIdx],
        suggested_category_id: catId,
        suggested_category_name: catId
          ? (accounts.find(a => a.id === catId)?.name || '')
          : '',
      };
      docData.groups = updatedGroups;
      updated[docId] = docData;
      return updated;
    });
  };

  // Toggle group expand/collapse
  const handleToggleGroup = (docId, groupIdx) => {
    const key = `${docId}:${groupIdx}`;
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Approve all transactions in a group
  const handleApproveGroup = async (docId, groupIdx) => {
    const docGroups = smartGroups[docId];
    if (!docGroups) return;
    const group = docGroups.groups[groupIdx];
    if (!group) return;

    const ids = group.transaction_ids;
    // Validate all have categories
    const missingCat = ids.filter(id => !(overrides[id] || group.suggested_category_id));
    if (missingCat.length > 0) {
      alert(`Cannot approve group: ${missingCat.length} transaction(s) are missing a category.`);
      return;
    }

    try {
      let failed = 0;
      for (const id of ids) {
        const categoryId = overrides[id] || group.suggested_category_id;
        try {
          await actionDocTransaction(id, { action: 'approve', category_id: categoryId });
        } catch (err) {
          console.error(`Failed to approve transaction ${id}:`, err);
          failed++;
        }
      }
      if (failed > 0) {
        alert(`${ids.length - failed} approved, ${failed} failed.`);
      }
      setSmartGroups({}); // Reset groups after approval
      await load();
    } catch (err) {
      console.error(err);
      alert('Group approval failed.');
    }
  };

  // Select/deselect all transactions in a group
  const handleSelectGroup = (docId, groupIdx) => {
    const docGroups = smartGroups[docId];
    if (!docGroups) return;
    const group = docGroups.groups[groupIdx];
    if (!group) return;
    const ids = group.transaction_ids;
    const allSelected = ids.every(id => selected.has(id));
    const next = new Set(selected);
    if (allSelected) {
      ids.forEach(id => next.delete(id));
    } else {
      ids.forEach(id => next.add(id));
    }
    setSelected(next);
  };

  // Detect when a group has mixed categories (some transactions overridden individually)
  const getGroupCategoryInfo = (docId, group) => {
    const groupCatId = group.suggested_category_id;
    const categories = group.transaction_ids.map(id => overrides[id] || groupCatId);
    const unique = [...new Set(categories.filter(Boolean))];
    return {
      isMixed: unique.length > 1,
      overrideCount: group.transaction_ids.filter(id => overrides[id] && overrides[id] !== groupCatId).length,
    };
  };

  const toggleSelect = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  // Updated: accepts visible (filtered) txns so select-all respects filters
  const toggleAllInDoc = (docId, visibleTxns) => {
    const reviewTxns = visibleTxns.filter(t => t.status === 'review');
    const allSelected = reviewTxns.length > 0 && reviewTxns.every(t => selected.has(t.id));

    const next = new Set(selected);
    if (allSelected) {
      // deselect all visible review in doc
      reviewTxns.forEach(t => next.delete(t.id));
    } else {
      // select all visible review in doc
      reviewTxns.forEach(t => next.add(t.id));
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

  // Total selected count (global)
  const totalSelectedCount = selected.size;

  // Count stats
  const reviewCount = docTxns.filter(t => t.status === 'review').length;
  const dupCount = docTxns.filter(t => t.is_duplicate).length;
  const postedCount = docTxns.filter(t => t.status === 'posted').length;

  // Helper to render the flat transaction table (used for non-review tabs and ungrouped txns)
  const renderFlatTable = (doc, filteredTxns, hasActiveFilter, allSelected, docReviewCount) => (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-white border-b border-gray-100">
          {(filter === 'review' || filter === '') && (
            <th className="py-2.5 px-3 text-left w-10">
              <input type="checkbox" checked={allSelected && docReviewCount > 0} onChange={() => toggleAllInDoc(doc.id, filteredTxns)} className="rounded text-primary-600 focus:ring-primary-500" />
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
        {filteredTxns.map(dt => (
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
  );

  // Render the smart grouped view for the review tab
  const renderGroupedView = (doc, filteredTxns) => {
    const docGroupData = smartGroups[doc.id];
    if (!docGroupData) return null;

    const { groups, ungrouped } = docGroupData;

    // Filter grouped transactions based on active document filters
    const filteredTxnIds = new Set(filteredTxns.map(t => t.id));

    return (
      <div className="p-4 space-y-3">
        {/* Grouped transactions */}
        {groups.length > 0 && (
          <div className="space-y-3">
            {groups.map((group, groupIdx) => {
              const key = `${doc.id}:${groupIdx}`;
              const isExpanded = expandedGroups.has(key);
              const { isMixed, overrideCount } = getGroupCategoryInfo(doc.id, group);
              // Filter group transactions based on doc filters
              const visibleTxns = group.transactions.filter(t => filteredTxnIds.has(t.id));
              if (visibleTxns.length === 0) return null;

              const allGroupSelected = group.transaction_ids.every(id => selected.has(id));
              const someGroupSelected = group.transaction_ids.some(id => selected.has(id));

              return (
                <div
                  key={key}
                  className={`border rounded-lg transition-all overflow-hidden ${confidenceBg(Math.round((group.confidence || 0) * 100))}`}
                >
                  {/* Group header */}
                  <div
                    className="p-3 cursor-pointer select-none hover:bg-black/[0.03] transition-colors flex items-start justify-between gap-3"
                    onClick={() => handleToggleGroup(doc.id, groupIdx)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {/* Checkbox for group selection */}
                        <div onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={allGroupSelected}
                            ref={el => { if (el) el.indeterminate = someGroupSelected && !allGroupSelected; }}
                            onChange={() => handleSelectGroup(doc.id, groupIdx)}
                            className="rounded text-primary-600 focus:ring-primary-500"
                          />
                        </div>
                        {/* Expand/collapse chevron */}
                        <span className="text-gray-400 flex-shrink-0">
                          {isExpanded
                            ? <ChevronDown className="w-4 h-4" />
                            : <ChevronRight className="w-4 h-4" />}
                        </span>
                        <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${confidenceDot(Math.round((group.confidence || 0) * 100))}`}></span>
                        <h5 className="font-medium text-gray-800 text-sm truncate">
                          {group.sample_description || 'Unnamed group'}
                        </h5>
                        <span className="text-xs text-gray-500 whitespace-nowrap bg-white/60 px-1.5 py-0.5 rounded">
                          × {visibleTxns.length} transaction{visibleTxns.length !== 1 ? 's' : ''}
                        </span>
                        {/* Transaction type badge (Withdrawal / Deposit) */}
                        {group.transaction_type && (
                          <span className={`text-[11px] px-1.5 py-0.5 rounded-full border whitespace-nowrap font-medium ${
                            group.transaction_type === 'Deposit'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-red-50 text-red-700 border-red-200'
                          }`}>
                            {group.transaction_type}
                          </span>
                        )}
                        {/* Mixed category indicator */}
                        {isMixed && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 whitespace-nowrap font-medium">
                            Mixed categories ({overrideCount} override{overrideCount !== 1 ? 's' : ''})
                          </span>
                        )}
                      </div>

                      {/* Suggested category & confidence */}
                      <div className="flex items-center gap-2 text-xs mb-2 ml-14">
                        {group.suggested_category_name && (
                          <span className={`font-medium ${confidenceColor(Math.round((group.confidence || 0) * 100))}`}>
                            {group.suggested_category_name}
                          </span>
                        )}
                        {group.confidence != null && (
                          <span className={confidenceColor(Math.round((group.confidence || 0) * 100))}>
                            ({Math.round((group.confidence || 0) * 100)}% confident)
                          </span>
                        )}
                        {group.match_reason && (
                          <span className="text-gray-400">— {group.match_reason}</span>
                        )}
                      </div>

                      {/* Category dropdown */}
                      <div className="max-w-xs ml-14" onClick={e => e.stopPropagation()}>
                        <GroupedAccountSelect
                          accounts={accounts}
                          value={group.suggested_category_id || ''}
                          onChange={e => handleGroupCategoryChange(doc.id, groupIdx, e.target.value)}
                          placeholder="Select category..."
                          className="input-field text-xs py-1 bg-white shadow-sm"
                          showCode={false}
                        />
                      </div>
                    </div>

                    {/* Approve group button */}
                    <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => handleApproveGroup(doc.id, groupIdx)}
                        className="p-2 rounded-lg transition-colors bg-white border border-gray-200 text-gray-400 hover:text-emerald-600 hover:border-emerald-300 hover:bg-emerald-50"
                        title="Approve all in group"
                      >
                        <Check className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  {/* Expanded individual transactions */}
                  {isExpanded && (
                    <div className="border-t border-gray-200/60 bg-white/60 max-h-[400px] overflow-y-auto">
                      <div className="divide-y divide-gray-100/80">
                        {visibleTxns.map(dt => {
                          const isOverridden = overrides[dt.id] && overrides[dt.id] !== group.suggested_category_id;
                          return (
                            <div
                              key={dt.id}
                              className={`flex items-center gap-3 pl-4 pr-4 py-2 hover:bg-gray-50/80 transition-colors ${
                                isOverridden ? 'bg-amber-50/40' : ''
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={selected.has(dt.id)}
                                onChange={() => toggleSelect(dt.id)}
                                className="rounded text-primary-600 focus:ring-primary-500 flex-shrink-0"
                              />
                              <span className="text-gray-400 text-xs w-20 flex-shrink-0">{dt.txn_date || '-'}</span>
                              <span className="text-gray-700 text-xs truncate flex-1 min-w-0" title={dt.description}>
                                {dt.description || '-'}
                              </span>
                              {dt.vendor_name && (
                                <span className="text-gray-400 text-[11px] truncate max-w-[6rem] flex-shrink-0">{dt.vendor_name}</span>
                              )}
                              <span className={`text-xs w-20 text-right font-medium flex-shrink-0 ${
                                (dt.amount || 0) >= 0 ? 'text-emerald-700' : 'text-gray-800'
                              }`}>
                                {formatMoney(dt.amount)}
                              </span>
                              <div className="w-44 flex-shrink-0">
                                <GroupedAccountSelect
                                  accounts={accounts}
                                  value={overrides[dt.id] || dt.suggested_category_id || dt.suggested_account_id || ''}
                                  onChange={e => setOverrides({ ...overrides, [dt.id]: parseInt(e.target.value) })}
                                  placeholder="Category..."
                                  className="input-field text-xs py-1 bg-white shadow-sm"
                                  showCode={false}
                                />
                              </div>
                              <div className="flex gap-1 flex-shrink-0">
                                <button
                                  onClick={() => handleAction(dt.id, 'approve', dt.suggested_account_id)}
                                  className="p-1 rounded hover:bg-emerald-100 text-emerald-600 transition-colors"
                                  title="Approve"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleAction(dt.id, 'reject')}
                                  className="p-1 rounded hover:bg-red-100 text-red-500 transition-colors"
                                  title="Reject"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Ungrouped transactions */}
        {ungrouped.length > 0 && (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
              <h5 className="text-sm font-semibold text-gray-700">
                Ungrouped Transactions ({ungrouped.filter(t => filteredTxnIds.has(t.id)).length})
              </h5>
              <p className="text-xs text-gray-500">These didn't match any pattern — assign categories individually.</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white border-b border-gray-100">
                  <th className="py-2.5 px-3 text-left w-10">
                    <input
                      type="checkbox"
                      checked={ungrouped.filter(t => filteredTxnIds.has(t.id)).length > 0 && ungrouped.filter(t => filteredTxnIds.has(t.id)).every(t => selected.has(t.id))}
                      onChange={() => {
                        const visUngrouped = ungrouped.filter(t => filteredTxnIds.has(t.id));
                        const allSel = visUngrouped.every(t => selected.has(t.id));
                        const next = new Set(selected);
                        visUngrouped.forEach(t => allSel ? next.delete(t.id) : next.add(t.id));
                        setSelected(next);
                      }}
                      className="rounded text-primary-600 focus:ring-primary-500"
                    />
                  </th>
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
                {ungrouped.filter(t => filteredTxnIds.has(t.id)).map(dt => (
                  <tr key={dt.id} className={`border-b border-gray-50 transition-colors hover:bg-gray-50/50 ${
                    selected.has(dt.id) ? 'bg-primary-50/50' : ''
                  }`}>
                    <td className="py-2 px-3">
                      <input type="checkbox" checked={selected.has(dt.id)} onChange={() => toggleSelect(dt.id)} className="rounded text-primary-600 focus:ring-primary-500" />
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap text-gray-600">{dt.txn_date || '-'}</td>
                    <td className="py-2 px-3 font-medium text-gray-800">{dt.vendor_name || '-'}</td>
                    <td className="py-2 px-3 text-gray-500 max-w-xs truncate" title={dt.description}>{dt.description || '-'}</td>
                    <td className={`py-2 px-3 text-right font-semibold whitespace-nowrap ${(dt.amount || 0) >= 0 ? 'text-emerald-600' : 'text-gray-900'}`}>
                      {formatMoney(dt.amount)}
                    </td>
                    <td className="py-2 px-3">
                      <GroupedAccountSelect
                        accounts={accounts}
                        value={overrides[dt.id] || dt.suggested_category_id || dt.suggested_account_id || ''}
                        onChange={(e) => setOverrides({...overrides, [dt.id]: parseInt(e.target.value)})}
                        placeholder="Uncategorized"
                        className="input-field text-xs py-1"
                      />
                    </td>
                    <td className="py-2 px-3 text-center">{confidenceBadge(dt.confidence)}</td>
                    <td className="py-2 px-3 text-right">
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
                        <button
                          onClick={() => setConfirmingDelete({ type: 'txn', id: dt.id })}
                          className="p-1.5 rounded-md hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                          title="Delete from inbox"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

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
              <p className="text-gray-400 text-sm max-w-[250px] mx-auto">Drag &amp; drop PDF bank statements here. Auto-categorized and checked for duplicates.</p>
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

      {/* Processing Status — pending and processing only */}
      {documents.filter(d => ['pending', 'processing'].includes(d.status)).length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold mb-3">Processing Queue</h3>
          <div className="space-y-2">
            {documents.filter(d => ['pending', 'processing'].includes(d.status)).map(doc => (
              <div key={doc.id} className="flex items-center justify-between gap-3 px-3 py-2 bg-gray-50 rounded-lg text-sm">
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="w-4 h-4 text-primary-500 flex-shrink-0" />
                  <span className="font-medium truncate">{doc.filename}</span>
                  <span className={`badge flex-shrink-0 ${
                    doc.status === 'processing' ? 'bg-blue-100 text-blue-700 animate-pulse' :
                    'bg-gray-100 text-gray-600'
                  }`}>{doc.status}</span>
                </div>
                <div className="flex-shrink-0">
                  {confirmingDelete?.type === 'doc' && confirmingDelete?.id === doc.id ? (
                    <div className="flex items-center gap-1 bg-white px-2 py-1 rounded-md border border-red-200 animate-in fade-in zoom-in-95">
                      <span className="text-xs font-bold text-red-700">Delete?</span>
                      <button
                        onClick={() => handleDeleteDocument(doc.id)}
                        className="p-1 rounded hover:bg-red-200 text-red-700 transition-colors"
                        title="Confirm Delete"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setConfirmingDelete(null)}
                        className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors"
                        title="Cancel"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmingDelete({ type: 'doc', id: doc.id })}
                      className="p-1.5 rounded-md hover:bg-red-200 text-red-400 hover:text-red-600 transition-colors flex items-center gap-1 text-xs font-medium"
                      title="Delete stuck record"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Delete</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Failed Imports — documents that errored during processing */}
      {documents.filter(d => d.status === 'error').length > 0 && (
        <div className="card border border-red-200 bg-red-50/20">
          <div className="flex items-center gap-2 mb-3">
            <XCircle className="w-5 h-5 text-red-500" />
            <h3 className="text-lg font-semibold text-red-700">Failed Imports</h3>
            <span className="text-sm text-red-500 font-normal">
              ({documents.filter(d => d.status === 'error').length})
            </span>
          </div>
          <div className="space-y-2">
            {documents.filter(d => d.status === 'error').map(doc => (
              <div key={doc.id} className="flex items-start gap-3 px-3 py-3 bg-red-50 rounded-lg border border-red-100 text-sm">
                <FileText className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-800">{doc.filename}</span>
                    <span className="badge bg-red-100 text-red-700">error</span>
                  </div>
                  {doc.error_msg && (
                    <p className="text-xs text-red-600 mt-1">{doc.error_msg}</p>
                  )}
                </div>
                <div className="flex-shrink-0">
                  {confirmingDelete?.type === 'doc' && confirmingDelete?.id === doc.id ? (
                    <div className="flex items-center gap-1 bg-white px-2 py-1 rounded-md border border-red-200 animate-in fade-in zoom-in-95">
                      <span className="text-xs font-bold text-red-700">Delete?</span>
                      <button
                        onClick={() => handleDeleteDocument(doc.id)}
                        className="p-1 rounded hover:bg-red-200 text-red-700 transition-colors"
                        title="Confirm Delete"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setConfirmingDelete(null)}
                        className="p-1 rounded hover:bg-gray-100 text-gray-400 transition-colors"
                        title="Cancel"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmingDelete({ type: 'doc', id: doc.id })}
                      className="p-1.5 rounded-md hover:bg-red-200 text-red-400 hover:text-red-600 transition-colors flex items-center gap-1 text-xs font-medium"
                      title="Delete failed import and its records"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Delete</span>
                    </button>
                  )}
                </div>
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
          <button key={f.key} onClick={() => { setFilter(f.key); setSmartGroups({}); }}
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

            // Apply per-document filters
            const filteredTxns = applyDocFilters(txns, doc.id);
            const hasActiveFilter = isDocFilterActive(doc.id);
            const docFilter = getDocFilter(doc.id);

            const docSelectedCount = filteredTxns.filter(t => selected.has(t.id)).length;
            const docReviewCount = filteredTxns.filter(t => t.status === 'review').length;
            const allSelected = docReviewCount > 0 && docSelectedCount === docReviewCount;
            
            // Determine if we should show the grouped view
            const showGroupedView = filter === 'review' && smartGroups[doc.id] && !groupingLoading[doc.id];
            const isLoadingGroups = filter === 'review' && groupingLoading[doc.id];

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
                        {hasActiveFilter && (
                          <span className="text-indigo-600 font-medium">
                            (showing {filteredTxns.length} of {txns.length})
                          </span>
                        )}
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

                {/* Per-Document Filter Bar */}
                <div className="bg-slate-50 border-b border-gray-200 px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Search input */}
                    <div className="relative flex-1 min-w-[180px] max-w-xs">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search description or vendor..."
                        value={docFilter.search}
                        onChange={(e) => updateDocFilter(doc.id, 'search', e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
                      />
                    </div>

                    {/* Amount filter */}
                    <div className="flex items-center gap-1">
                      <select
                        value={docFilter.amountOp}
                        onChange={(e) => updateDocFilter(doc.id, 'amountOp', e.target.value)}
                        className="text-xs border border-gray-200 rounded-md bg-white py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
                      >
                        <option value="any">Any Amount</option>
                        <option value="eq">Equals</option>
                        <option value="gt">Greater than</option>
                        <option value="lt">Less than</option>
                        <option value="gte">≥ (at least)</option>
                        <option value="lte">≤ (at most)</option>
                        <option value="between">Between</option>
                      </select>
                      {docFilter.amountOp && docFilter.amountOp !== 'any' && docFilter.amountOp !== 'between' && (
                        <input
                          type="number"
                          placeholder="$0.00"
                          value={docFilter.amountVal}
                          onChange={(e) => updateDocFilter(doc.id, 'amountVal', e.target.value)}
                          className="w-24 text-xs border border-gray-200 rounded-md bg-white py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
                          step="0.01"
                          min="0"
                        />
                      )}
                      {docFilter.amountOp === 'between' && (
                        <>
                          <input
                            type="number"
                            placeholder="Min"
                            value={docFilter.amountMin}
                            onChange={(e) => updateDocFilter(doc.id, 'amountMin', e.target.value)}
                            className="w-20 text-xs border border-gray-200 rounded-md bg-white py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
                            step="0.01"
                            min="0"
                          />
                          <span className="text-xs text-gray-400">–</span>
                          <input
                            type="number"
                            placeholder="Max"
                            value={docFilter.amountMax}
                            onChange={(e) => updateDocFilter(doc.id, 'amountMax', e.target.value)}
                            className="w-20 text-xs border border-gray-200 rounded-md bg-white py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400"
                            step="0.01"
                            min="0"
                          />
                        </>
                      )}
                    </div>

                    {/* Category filter */}
                    <select
                      value={docFilter.categoryId}
                      onChange={(e) => updateDocFilter(doc.id, 'categoryId', e.target.value)}
                      className="text-xs border border-gray-200 rounded-md bg-white py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400 max-w-[180px]"
                    >
                      <option value="">All Categories</option>
                      {accounts.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.code ? `${a.code} – ` : ''}{a.name}
                        </option>
                      ))}
                    </select>

                    {/* Clear Filters */}
                    {hasActiveFilter && (
                      <button
                        onClick={() => clearDocFilter(doc.id)}
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-800 px-2 py-1.5 rounded-md hover:bg-indigo-50 transition-colors flex items-center gap-1"
                      >
                        <X className="w-3 h-3" />
                        Clear Filters
                      </button>
                    )}

                    {/* Filter result count */}
                    {hasActiveFilter && (
                      <span className="text-xs text-gray-500 ml-auto">
                        Showing <strong className="text-indigo-600">{filteredTxns.length}</strong> of {txns.length}
                      </span>
                    )}
                  </div>
                </div>

                {/* Document Transactions — Grouped or Flat View */}
                <div className="overflow-x-auto bg-white">
                  {filteredTxns.length === 0 && hasActiveFilter ? (
                    <div className="py-8 text-center text-gray-400 text-sm">
                      <Filter className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                      <p>No transactions match your filters.</p>
                      <button
                        onClick={() => clearDocFilter(doc.id)}
                        className="mt-2 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                      >
                        Clear Filters
                      </button>
                    </div>
                  ) : isLoadingGroups ? (
                    <div className="py-10 text-center">
                      <Loader2 className="w-6 h-6 text-primary-500 animate-spin mx-auto mb-2" />
                      <p className="text-sm text-gray-500">Analyzing transaction patterns...</p>
                    </div>
                  ) : showGroupedView ? (
                    renderGroupedView(doc, filteredTxns)
                  ) : (
                    renderFlatTable(doc, filteredTxns, hasActiveFilter, allSelected, docReviewCount)
                  )}
                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* Global Floating Bulk Action Bar */}
      {totalSelectedCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none pb-4">
          <div className="pointer-events-auto bg-indigo-700 text-white rounded-xl shadow-2xl border border-indigo-600 px-5 py-3 flex flex-wrap items-center gap-3 max-w-3xl">
            {/* Count */}
            <div className="flex items-center gap-2 pr-3 border-r border-indigo-500">
              <CheckCircle2 className="w-4 h-4 text-indigo-300" />
              <span className="text-sm font-semibold">{totalSelectedCount} transaction{totalSelectedCount !== 1 ? 's' : ''} selected</span>
            </div>

            {/* Set Category */}
            <div className="flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-indigo-300" />
              <select
                value={bulkCategoryId}
                onChange={(e) => {
                  if (e.target.value) {
                    handleBulkSetCategory(e.target.value);
                  }
                }}
                className="text-xs bg-indigo-600 text-white border border-indigo-500 rounded-md py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-indigo-300 cursor-pointer"
              >
                <option value="">Set Category...</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.code ? `${a.code} – ` : ''}{a.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Approve All */}
            <button
              onClick={() => handleGlobalBulkAction('approve')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-500 hover:bg-emerald-400 text-white transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              Approve All
            </button>

            {/* Reject All */}
            <button
              onClick={() => handleGlobalBulkAction('reject')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-500 hover:bg-red-400 text-white transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Reject All
            </button>

            {/* Clear Selection */}
            <button
              onClick={() => setSelected(new Set())}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-indigo-200 hover:text-white hover:bg-indigo-600 transition-colors ml-1"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
