import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { X, UploadCloud, CheckCircle2, ChevronRight, ChevronDown, FileSpreadsheet, AlertCircle, PlusCircle, Check, Sparkles } from 'lucide-react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { parse, isValid, parseISO } from 'date-fns';
import { importMappedCsv, getBankAccounts, createBankAccount, suggestCategories, createAccount, getAccounts } from '../api/client';
import GroupedAccountSelect from './GroupedAccountSelect';

const REQUIRED_FIELDS = [
  { id: 'date', label: 'Date', required: true },
  { id: 'description', label: 'Description', required: true },
  { id: 'amount', label: 'Amount', required: true },
  { id: 'vendor', label: 'Vendor / Payee', required: false },
];

// Helper for robust date parsing
function tryParseDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  
  // Try native ISO
  let d = parseISO(s);
  if (isValid(d) && d.getFullYear() > 2000) return d.toISOString().slice(0, 10);
  
  // Try common US/Intl formats
  const formats = [
    'MM/dd/yyyy', 'MM-dd-yyyy', 
    'M/d/yyyy', 'M-d-yyyy',
    'MM/dd/yy', 'M/d/yy',
    'dd/MM/yyyy', 'dd-MM-yyyy',
    'd-MMM-yy', 'dd-MMM-yyyy',
    'yyyy-MM-dd', 'yyyy/MM/dd'
  ];
  
  for (const fmt of formats) {
    d = parse(s, fmt, new Date());
    if (isValid(d) && d.getFullYear() > 2000 && d.getFullYear() < 2100) {
      return d.toISOString().slice(0, 10);
    }
  }

  // Attempt to let the browser parse it natively
  d = new Date(s);
  if (isValid(d) && d.getFullYear() > 2000) return d.toISOString().slice(0, 10);

  return null; 
}

// Convert "($12.00)" to -12.00
function parseAmount(val) {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return val;
  let s = String(val).trim().replace(/,/g, '').replace('$', '');
  if (s.startsWith('(') && s.endsWith(')')) {
    s = '-' + s.substring(1, s.length - 1);
  }
  const amt = parseFloat(s);
  return isNaN(amt) ? 0 : amt;
}

// Confidence color helpers
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

export default function ImportWizard({ onClose, onSuccess, accounts: initialAccounts = [] }) {
  const [step, setStep] = useState(1); // 1: Upload, 2: Map, 3: Categorize, 4: Preview & Import
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Local accounts state – starts from prop, refreshed after creating new accounts
  const [localAccounts, setLocalAccounts] = useState(initialAccounts);
  useEffect(() => { setLocalAccounts(initialAccounts); }, [initialAccounts]);

  // Category accounts = income/expense only (per DEVELOPMENT_RULES.md)
  const categoryAccounts = useMemo(
    () => localAccounts.filter(a => a.type === 'income' || a.type === 'expense'),
    [localAccounts]
  );
  
  // Bank accounts
  const [bankAccounts, setBankAccounts] = useState([]);
  const [loadingBankAccounts, setLoadingBankAccounts] = useState(false);
  
  // Add Bank Account inline form
  const [showAddBank, setShowAddBank] = useState(false);
  const [newBankName, setNewBankName] = useState('');
  const [newLastFour, setNewLastFour] = useState('');
  const [newAccountType, setNewAccountType] = useState('checking');
  const [addingBank, setAddingBank] = useState(false);
  
  // Multi-sheet and Account selection
  const [workbook, setWorkbook] = useState(null);
  const [sheets, setSheets] = useState([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [selectedBankAccountId, setSelectedBankAccountId] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');

  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  
  // Mapping logic
  const [mapping, setMapping] = useState({});
  const [amountType, setAmountType] = useState('single'); // 'single' or 'split'

  // Categorization state (Step 3)
  const [categorizationGroups, setCategorizationGroups] = useState([]);
  const [ungroupedIndices, setUngroupedIndices] = useState([]);
  const [categoryAssignments, setCategoryAssignments] = useState({}); // { txnIndex: category_id }
  const [approvedGroups, setApprovedGroups] = useState(new Set());
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [loadingCategories, setLoadingCategories] = useState(false);

  // New Account modal state
  const [showNewAccountModal, setShowNewAccountModal] = useState(false);
  const [newAccountContext, setNewAccountContext] = useState(null); // { type: 'group'|'ungrouped', index: number }
  const [newAccountForm, setNewAccountForm] = useState({ name: '', type: 'expense', code: '' });
  const [savingNewAccount, setSavingNewAccount] = useState(false);

  const fileInputRef = useRef();

  // Fetch bank accounts on component mount
  useEffect(() => {
    const fetchBankAccounts = async () => {
      setLoadingBankAccounts(true);
      setError('');
      try {
        const data = await getBankAccounts();
        const accountsArray = Array.isArray(data) ? data : [];
        setBankAccounts(accountsArray);
        if (accountsArray.length === 0) {
          console.log('No bank accounts found - user can still import and select/create one');
        }
      } catch (err) {
        console.error('Failed to fetch bank accounts:', err);
        setBankAccounts([]);
      } finally {
        setLoadingBankAccounts(false);
      }
    };
    fetchBankAccounts();
  }, []);

  const handleAddBankAccount = async () => {
    if (!newBankName.trim()) return;
    setAddingBank(true);
    try {
      const ba = await createBankAccount({
        bank_name: newBankName.trim(),
        last_four: newLastFour.trim() || '0000',
        account_type: newAccountType,
      });
      // Refresh the full list to get linked COA info
      try {
        const refreshed = await getBankAccounts();
        setBankAccounts(Array.isArray(refreshed) ? refreshed : []);
      } catch {
        // Fallback: just add to existing list
        setBankAccounts(prev => [...prev, ba]);
      }
      setSelectedBankAccountId(String(ba.id));
      setShowAddBank(false);
      setNewBankName('');
      setNewLastFour('');
      setNewAccountType('checking');
    } catch (err) {
      setError('Failed to create bank account: ' + err.message);
    } finally {
      setAddingBank(false);
    }
  };

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (f) processFile(f);
  };

  const processFile = async (f) => {
    setError('');
    setLoading(true);
    setWorkbook(null);
    setSheets([]);
    try {
      if (f.name.endsWith('.csv')) {
        Papa.parse(f, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            if (!results.meta.fields || results.meta.fields.length === 0) {
              setError("Could not parse CSV headers. Make sure it has a header row.");
              setLoading(false);
              return;
            }
            setHeaders(results.meta.fields);
            setRows(results.data);
            setFile(f);
            autoMap(results.meta.fields);
            setStep(2);
            setLoading(false);
          },
          error: (err) => {
            setError('Failed to parse CSV: ' + err.message);
            setLoading(false);
          }
        });
      } else if (f.name.match(/\.xlsx?$/)) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const data = evt.target.result;
            const wb = XLSX.read(data, { type: 'binary', cellDates: true });
            setWorkbook(wb);
            setSheets(wb.SheetNames);
            setFile(f);
            
            // Auto-load first sheet
            loadSheetData(wb, wb.SheetNames[0]);
            setLoading(false);
          } catch (e) {
            setError("Failed to parse Excel file: " + e.message);
            setLoading(false);
          }
        };
        reader.readAsBinaryString(f);
      } else {
        setError('Unsupported file type. Please upload a .csv, .xls, or .xlsx file.');
        setLoading(false);
      }
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const loadSheetData = (wb, sheetName) => {
    setSelectedSheet(sheetName);
    const sheet = wb.Sheets[sheetName];
    // Use header: 1 to get all columns including those with empty values in first row
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' });
    if (json.length === 0) {
      setHeaders([]);
      setRows([]);
      setMapping({});
      return;
    }
    // First row contains headers
    const cols = json[0].map(h => h != null ? String(h).trim() : '');
    // Convert remaining rows to objects with header keys
    const dataRows = json.slice(1).map(row => {
      const obj = {};
      cols.forEach((col, idx) => {
        if (col) { // Only include columns with non-empty headers
          obj[col] = row[idx];
        }
      });
      return obj;
    });
    setHeaders(cols.filter(c => c)); // Filter out empty header strings
    setRows(dataRows);
    autoMap(cols.filter(c => c));
    setStep(2);
  };

  const handleSheetChange = (e) => {
    const sName = e.target.value;
    if (workbook && sName) {
      loadSheetData(workbook, sName);
    }
  };

  const autoMap = (availableHeaders) => {
    const m = {};
    const lower = availableHeaders.map(h => h.toLowerCase().trim());
    
    // Date
    let idx = lower.findIndex(h => h.includes('date') || h.includes('posted') || h.includes('txn'));
    if (idx !== -1) m.date = availableHeaders[idx];
    
    // Description
    idx = lower.findIndex(h => h.includes('description') || h.includes('memo') || h.includes('payee') || h.includes('name'));
    if (idx !== -1) m.description = availableHeaders[idx];
    
    // Amount - determine if single column or split
    let singleAmtIdx = lower.findIndex(h => h === 'amount' || h === 'value');
    
    // Try to find Debit/Credit/Withdrawal/Deposit (support both singular and plural forms)
    let outIdx = lower.findIndex(h => h.includes('debit') || h.includes('withdrawal') || h === 'out' || h === 'paid out');
    let inIdx = lower.findIndex(h => h.includes('credit') || h.includes('deposit') || h === 'in' || h === 'paid in');
    
    if (outIdx !== -1 && inIdx !== -1) {
      setAmountType('split');
      m.amountOut = availableHeaders[outIdx];
      m.amountIn = availableHeaders[inIdx];
    } else if (singleAmtIdx !== -1) {
      setAmountType('single');
      m.amountStr = availableHeaders[singleAmtIdx];
    } else if (outIdx !== -1) {
      setAmountType('single');
      m.amountStr = availableHeaders[outIdx];
    }
    
    // Vendor/Payee (optional)
    idx = lower.findIndex(h => h === 'payee' || h === 'vendor' || h === 'merchant');
    if (idx !== -1 && availableHeaders[idx] !== m.description) {
      m.vendor = availableHeaders[idx];
    }
    
    setMapping(m);
  };

  const isMappingValid = () => {
    if (!mapping.date || !mapping.description) return false;
    if (!selectedBankAccountId) return false;
    if (amountType === 'single') {
      return !!mapping.amountStr;
    } else {
      return !!(mapping.amountIn || mapping.amountOut);
    }
  };

  const getAmountFromMapped = (row) => {
    if (amountType === 'single') {
      return parseAmount(row[mapping.amountStr]);
    }
    const valIn = parseAmount(row[mapping.amountIn]);
    const valOut = Math.abs(parseAmount(row[mapping.amountOut]));
    if (valIn) return Math.abs(valIn);
    if (valOut) return -valOut;
    return 0;
  };

  // Compute mapped data once we go past step 2
  const mappedData = useMemo(() => {
    if (step < 3) return [];
    
    return rows.map((row) => {
      const dateRaw = row[mapping.date];
      const descRaw = row[mapping.description] || "";
      const amt = getAmountFromMapped(row);
      const vendorRaw = mapping.vendor ? row[mapping.vendor] : "";
      
      const parsedDate = tryParseDate(dateRaw);
      
      return {
        _raw_date: dateRaw,
        txn_date: parsedDate || new Date().toISOString().slice(0,10),
        _date_valid: parsedDate !== null,
        description: String(descRaw),
        amount: amt,
        vendor_name: String(vendorRaw),
      };
    }).filter(r => r.description.trim() !== '' && r.amount !== 0);
  }, [rows, mapping, step, amountType]);

  // Fetch smart category suggestions when entering step 3
  const fetchCategorySuggestions = useCallback(async () => {
    if (mappedData.length === 0) return;
    setLoadingCategories(true);
    setError('');
    try {
      const payload = {
        transactions: mappedData.map(d => ({
          description: d.description,
          amount: d.amount,
          date: d.txn_date,
        })),
        bank_account_id: selectedBankAccountId ? parseInt(selectedBankAccountId, 10) : null,
      };
      const result = await suggestCategories(payload);
      const groups = Array.isArray(result.groups) ? result.groups : [];
      setCategorizationGroups(groups);
      setUngroupedIndices(Array.isArray(result.ungrouped_indices) ? result.ungrouped_indices : []);
      
      // Pre-populate category assignments from suggestions
      const assignments = {};
      for (const group of groups) {
        if (group.suggested_category_id) {
          for (const idx of group.transaction_indices) {
            assignments[idx] = group.suggested_category_id;
          }
        }
      }
      setCategoryAssignments(assignments);
      setApprovedGroups(new Set());
    } catch (err) {
      console.error('Category suggestion failed:', err);
      setError('Smart categorization failed — you can still assign categories manually.');
      setCategorizationGroups([]);
      setUngroupedIndices(mappedData.map((_, i) => i));
      setCategoryAssignments({});
    } finally {
      setLoadingCategories(false);
    }
  }, [mappedData, selectedBankAccountId]);

  // Trigger categorization when step changes to 3
  useEffect(() => {
    if (step === 3) {
      fetchCategorySuggestions();
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGroupCategoryChange = (groupIdx, newCategoryId) => {
    const group = categorizationGroups[groupIdx];
    if (!group) return;
    // Changing group category resets ALL individual overrides in this group
    const newAssignments = { ...categoryAssignments };
    for (const idx of group.transaction_indices) {
      newAssignments[idx] = newCategoryId ? parseInt(newCategoryId, 10) : null;
    }
    setCategoryAssignments(newAssignments);
    // Update the group's suggested category for display
    const updatedGroups = [...categorizationGroups];
    updatedGroups[groupIdx] = {
      ...updatedGroups[groupIdx],
      suggested_category_id: newCategoryId ? parseInt(newCategoryId, 10) : null,
      suggested_category_name: newCategoryId
        ? (categoryAccounts.find(a => a.id === parseInt(newCategoryId, 10))?.name || '')
        : '',
    };
    setCategorizationGroups(updatedGroups);
  };

  const handleUngroupedCategoryChange = (txnIdx, newCategoryId) => {
    setCategoryAssignments(prev => ({
      ...prev,
      [txnIdx]: newCategoryId ? parseInt(newCategoryId, 10) : null,
    }));
  };

  const handleApproveGroup = (groupIdx) => {
    setApprovedGroups(prev => {
      const next = new Set(prev);
      next.add(groupIdx);
      return next;
    });
  };

  const handleToggleGroup = (groupIdx) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupIdx)) next.delete(groupIdx);
      else next.add(groupIdx);
      return next;
    });
  };

  const handleIndividualCategoryChange = (groupIdx, txnIdx, categoryId) => {
    setCategoryAssignments(prev => ({
      ...prev,
      [txnIdx]: categoryId ? parseInt(categoryId, 10) : null,
    }));
  };

  // ── New Account modal handlers ──
  const handleAddNewAccount = (context) => {
    setNewAccountContext(context);
    setNewAccountForm({ name: '', type: 'expense', code: '' });
    setShowNewAccountModal(true);
  };

  const handleSaveNewAccount = async () => {
    if (!newAccountForm.name.trim()) return;
    setSavingNewAccount(true);
    setError('');
    try {
      const created = await createAccount({
        name: newAccountForm.name.trim(),
        type: newAccountForm.type,
        code: newAccountForm.code.trim() || undefined,
      });
      // Refresh the full accounts list
      try {
        const refreshed = await getAccounts();
        const acctArray = Array.isArray(refreshed) ? refreshed : [];
        setLocalAccounts(acctArray);
      } catch {
        // Fallback: append to local list
        setLocalAccounts(prev => [...prev, created]);
      }
      // Auto-assign the new account to the dropdown that triggered the modal
      if (newAccountContext) {
        const newId = created.id;
        if (newAccountContext.type === 'group') {
          handleGroupCategoryChange(newAccountContext.index, newId);
        } else if (newAccountContext.type === 'ungrouped') {
          handleUngroupedCategoryChange(newAccountContext.index, newId);
        } else if (newAccountContext.type === 'grouped-individual') {
          handleIndividualCategoryChange(newAccountContext.groupIndex, newAccountContext.txnIndex, newId);
        }
      }
      setShowNewAccountModal(false);
      setNewAccountContext(null);
    } catch (err) {
      setError('Failed to create account: ' + err.message);
    } finally {
      setSavingNewAccount(false);
    }
  };

  const handleCancelNewAccount = () => {
    setShowNewAccountModal(false);
    setNewAccountContext(null);
  };

  const handleApproveAll = () => {
    const allIndices = new Set();
    categorizationGroups.forEach((_, i) => allIndices.add(i));
    setApprovedGroups(allIndices);
  };

  const getCategoryName = (categoryId) => {
    if (!categoryId) return '';
    const acct = localAccounts.find(a => a.id === categoryId);
    return acct ? acct.name : '';
  };

  // Detect when a group has mixed (individually overridden) categories
  const getGroupCategoryInfo = (group) => {
    const groupCatId = group.suggested_category_id;
    const categories = group.transaction_indices.map(i => categoryAssignments[i]);
    const unique = [...new Set(categories.filter(Boolean))];
    const overrideCount = groupCatId
      ? categories.filter(c => c && c !== groupCatId).length
      : 0;
    return { isMixed: unique.length > 1, uniqueCount: unique.length, overrideCount };
  };

  // Get display data for an individual transaction by its index into mappedData
  const getTransactionData = (txnIdx) => {
    const d = mappedData[txnIdx];
    if (!d) return null;
    return {
      date: d.txn_date || '',
      description: d.description || '',
      amount: d.amount != null ? d.amount.toFixed(2) : '0.00',
      vendor: d.vendor_name || '',
    };
  };

  const handleImport = async () => {
    setLoading(true);
    setError('');

    try {
      // Validate required data before sending
      if (!selectedBankAccountId) {
        throw new Error('Please select a bank account before importing.');
      }
      if (!mappedData || mappedData.length === 0) {
        throw new Error('No transactions to import. Please check your file mapping.');
      }

      const payload = {
        filename: file.name + (selectedSheet ? ` [${selectedSheet}]` : ''),
        bank_account_id: selectedBankAccountId ? parseInt(selectedBankAccountId, 10) : null,
        category_id: selectedCategoryId ? parseInt(selectedCategoryId, 10) : null,
        transactions: mappedData.map((d, i) => ({
          txn_date: d.txn_date,
          description: d.description,
          amount: d.amount,
          vendor_name: d.vendor_name || '',
          category_id: categoryAssignments[i] || (selectedCategoryId ? parseInt(selectedCategoryId, 10) : null),
        }))
      };
      
      await importMappedCsv(payload);
      onSuccess();
    } catch (e) {
      console.error('Import error:', e);
      // Extract more meaningful error message
      let errorMsg = e.message || 'An unexpected error occurred';
      
      // Handle API error responses that might be HTML (like 500 errors)
      if (errorMsg.includes('API 500') || errorMsg.includes('<!DOCTYPE')) {
        errorMsg = 'Server error occurred. Please try again or contact support if the problem persists.';
      }
      
      setError('Import failed: ' + errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const stepLabels = ['1. Upload', '2. Map Columns', '3. Categorize', '4. Preview & Import'];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
          <div className="flex items-center gap-3 text-lg font-semibold text-gray-800">
            <FileSpreadsheet className="w-6 h-6 text-primary-600" />
            Import CSV / Excel Wizard
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:bg-gray-200 rounded-full transition-colors">
            <X className="w-5 h-5"/>
          </button>
        </div>

        {/* Wizard Steps */}
        <div className="px-6 py-4 border-b border-gray-100 bg-white flex items-center justify-center">
          <div className="flex items-center gap-2 text-sm font-medium">
            {stepLabels.map((label, i) => (
              <React.Fragment key={i}>
                {i > 0 && <ChevronRight className="w-4 h-4 text-gray-300" />}
                <span className={`px-2.5 py-1 rounded-full ${step >= i + 1 ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-400'}`}>
                  {label}
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 bg-white">
          {error && (
            <div className="mb-6 bg-red-50 text-red-700 p-4 rounded-lg flex items-start gap-3 border border-red-100">
              <AlertCircle className="w-5 h-5 mt-0.5" />
              <div>
                <h4 className="font-medium">Error</h4>
                <p className="text-sm">{error}</p>
              </div>
            </div>
          )}

          {/* ═══ STEP 1: Upload ═══ */}
          {step === 1 && (
            <div className="flex flex-col items-center justify-center py-16 px-4 border-2 border-dashed border-gray-200 rounded-xl hover:border-primary-400 transition-colors bg-gray-50">
              <UploadCloud className="w-16 h-16 text-primary-200 mb-4" />
              <h3 className="text-xl font-medium text-gray-800 mb-2">Upload your statement</h3>
              <p className="text-gray-500 mb-6 text-center max-w-sm">We support .csv, .xls, and .xlsx files exported from your bank.</p>
              <input 
                type="file" 
                accept=".csv, .xls, .xlsx" 
                className="hidden" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
              />
              <button 
                onClick={() => fileInputRef.current.click()} 
                disabled={loading}
                className="btn-primary py-2.5 px-6 shadow-md"
              >
                {loading ? 'Processing...' : 'Browse Computer'}
              </button>
            </div>
          )}

          {/* ═══ STEP 2: Map Columns ═══ */}
          {step === 2 && (
            <div className="space-y-6">
              <p className="text-gray-600">Please configure your import settings for <strong>{file?.name}</strong>.</p>
              
              {/* Top Settings Row: Sheet, Bank Account & Category */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-5 flex flex-col gap-6">
                
                {/* First row: Excel Sheet and Bank Account */}
                <div className="flex flex-col md:flex-row gap-6">
                  {sheets.length > 1 && (
                    <div className="w-full md:w-1/2 flex flex-col gap-1.5">
                      <label className="text-sm font-semibold text-gray-700">Excel Sheet <span className="text-red-500">*</span></label>
                      <select 
                        className="input-field bg-white shadow-sm"
                        value={selectedSheet}
                        onChange={handleSheetChange}
                      >
                        {sheets.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  )}
                  
                  {/* Bank Account Selection (Required) */}
                  <div className={`w-full ${sheets.length > 1 ? 'md:w-1/2' : ''} flex flex-col gap-1.5`}>
                    <label className="text-sm font-semibold text-gray-700">
                      Bank Account <span className="text-red-500">*</span>
                    </label>
                    <div className="flex gap-2">
                      <select
                        className="input-field bg-white shadow-sm flex-1"
                        value={selectedBankAccountId}
                        onChange={e => setSelectedBankAccountId(e.target.value)}
                        disabled={loadingBankAccounts}
                      >
                        <option value="">
                          {loadingBankAccounts ? 'Loading bank accounts...' : '-- Select bank account --'}
                        </option>
                        {bankAccounts.length === 0 ? (
                          <option disabled>No bank accounts found</option>
                        ) : (
                          bankAccounts.map(ba => (
                            <option key={ba.id} value={ba.id}>
                              {ba.bank_name} {ba.last_four ? `(...${ba.last_four})` : ''}
                              {ba.ledger_account_name ? ` → ${ba.ledger_account_name}` : ''}
                            </option>
                          ))
                        )}
                      </select>
                      <button
                        type="button"
                        onClick={() => setShowAddBank(!showAddBank)}
                        className="px-3 py-2 text-sm font-medium text-primary-700 bg-primary-50 border border-primary-200 rounded-lg hover:bg-primary-100 transition-colors whitespace-nowrap flex items-center gap-1"
                        title="Add a new bank account"
                      >
                        <PlusCircle className="w-4 h-4" /> New
                      </button>
                    </div>
                    
                    {/* Inline Add Bank Account Form */}
                    {showAddBank && (
                      <div className="mt-2 p-3 bg-white border border-primary-200 rounded-lg shadow-sm space-y-2">
                        <p className="text-xs font-semibold text-gray-700">Add New Bank Account</p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Bank Name (e.g., Chase)"
                            value={newBankName}
                            onChange={e => setNewBankName(e.target.value)}
                            className="input-field bg-white shadow-sm flex-1 text-sm"
                          />
                          <input
                            type="text"
                            placeholder="Last 4 digits"
                            value={newLastFour}
                            onChange={e => setNewLastFour(e.target.value.replace(/\D/g, '').slice(0, 4))}
                            className="input-field bg-white shadow-sm w-28 text-sm"
                            maxLength={4}
                          />
                        </div>
                        <div className="flex gap-2 items-center">
                          <select
                            value={newAccountType}
                            onChange={e => setNewAccountType(e.target.value)}
                            className="input-field bg-white shadow-sm text-sm flex-1"
                          >
                            <option value="checking">Checking</option>
                            <option value="savings">Savings</option>
                            <option value="credit_card">Credit Card</option>
                          </select>
                          <button
                            type="button"
                            onClick={handleAddBankAccount}
                            disabled={addingBank || !newBankName.trim()}
                            className="px-3 py-1.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {addingBank ? 'Adding...' : 'Add'}
                          </button>
                        </div>
                        <p className="text-xs text-gray-500">A linked Chart of Accounts entry will be created automatically.</p>
                      </div>
                    )}

                    <p className="text-xs text-gray-500">
                      Transactions will be linked to this bank account
                    </p>
                  </div>
                </div>

                {/* Second row: Default Category (Optional) */}
                <div className="flex flex-col md:flex-row gap-6">
                  <div className="w-full md:w-1/2 flex flex-col gap-1.5">
                    <label className="text-sm font-semibold text-gray-700">
                      Default Category <span className="text-gray-400 font-normal">(Optional)</span>
                    </label>
                    <GroupedAccountSelect
                      accounts={categoryAccounts}
                      value={selectedCategoryId}
                      onChange={e => setSelectedCategoryId(e.target.value)}
                      placeholder="-- Let system auto-categorize --"
                      className="input-field bg-white shadow-sm"
                    />
                    <p className="text-xs text-gray-500">
                      Fallback category if smart categorization doesn't match. Leave empty for auto-categorization.
                    </p>
                  </div>
                </div>

              </div>

              {/* Column Mapping Row */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-5">
                <h4 className="text-sm font-semibold text-gray-800 mb-4">Column Mapping</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {REQUIRED_FIELDS.map(f => (
                    <div key={f.id} className="flex flex-col gap-1.5">
                      <label className="text-sm font-semibold text-gray-700">
                        {f.label} {f.required && <span className="text-red-500">*</span>}
                      </label>
                      {f.id === 'amount' ? (
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-4 mb-1">
                            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                              <input type="radio" checked={amountType==='single'} onChange={() => setAmountType('single')} className="text-primary-600 focus:ring-primary-500" />
                              Single Column (+/-)
                            </label>
                            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                              <input type="radio" checked={amountType==='split'} onChange={() => setAmountType('split')} className="text-primary-600 focus:ring-primary-500" />
                              Two Columns (In/Out)
                            </label>
                          </div>
                          
                          {amountType === 'single' ? (
                            <select 
                              className="input-field bg-white shadow-sm"
                              value={mapping.amountStr || ''}
                              onChange={e => setMapping({...mapping, amountStr: e.target.value})}
                            >
                              <option value="">-- Select amount column --</option>
                              {headers.map(h => <option key={h} value={h}>{h}</option>)}
                            </select>
                          ) : (
                            <div className="flex gap-2">
                              <select 
                                className="input-field bg-white shadow-sm flex-1"
                                value={mapping.amountIn || ''}
                                onChange={e => setMapping({...mapping, amountIn: e.target.value})}
                              >
                                <option value="">-- Deposit / In --</option>
                                {headers.map(h => <option key={h} value={h}>{h}</option>)}
                              </select>
                              <select 
                                className="input-field bg-white shadow-sm flex-1"
                                value={mapping.amountOut || ''}
                                onChange={e => setMapping({...mapping, amountOut: e.target.value})}
                              >
                                <option value="">-- Withdrawal / Out --</option>
                                {headers.map(h => <option key={h} value={h}>{h}</option>)}
                              </select>
                            </div>
                          )}
                        </div>
                      ) : (
                        <select 
                          className="input-field bg-white shadow-sm"
                          value={mapping[f.id] || ''}
                          onChange={e => setMapping({...mapping, [f.id]: e.target.value})}
                        >
                          <option value="">-- Select column --</option>
                          {headers.map(h => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      )}
                      {f.id === 'date' && (
                        <p className="text-xs text-gray-500">We automatically detect dates like MM/DD/YYYY, YYYY-MM-DD, etc.</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick sample preview */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Sample Row based on mapping:</h4>
                <div className="overflow-x-auto border border-gray-200 rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-4 py-2 text-left text-gray-500 font-medium">Date</th>
                        <th className="px-4 py-2 text-left text-gray-500 font-medium">Description</th>
                        <th className="px-4 py-2 text-right text-gray-500 font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {rows.slice(0, 3).map((r, i) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                          <td className="px-4 py-3">{mapping.date ? r[mapping.date] : '-'}</td>
                          <td className="px-4 py-3">{mapping.description ? r[mapping.description] : '-'}</td>
                          <td className="px-4 py-3 text-right">
                            {amountType === 'single' ? String(r[mapping.amountStr] || '-') : `In: ${r[mapping.amountIn] || '-'} | Out: ${r[mapping.amountOut] || '-'}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ═══ STEP 3: Categorize ═══ */}
          {step === 3 && (
            <div className="space-y-6">
              {/* Header info */}
              <div className="bg-blue-50 text-blue-800 p-4 rounded-lg flex items-center gap-3 border border-blue-100">
                <Sparkles className="w-5 h-5 text-blue-500" />
                <div>
                  <p className="font-medium text-sm">Smart Categorization</p>
                  <p className="text-xs text-blue-600">
                    We've grouped {mappedData.length} transactions by similarity and suggested categories. Review and adjust as needed.
                  </p>
                </div>
              </div>

              {loadingCategories ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600 mb-4"></div>
                  <p className="text-gray-500 text-sm">Analyzing transactions and suggesting categories...</p>
                </div>
              ) : (
                <>
                  {/* Approve All button */}
                  {categorizationGroups.length > 0 && (
                    <div className="flex justify-end">
                      <button
                        onClick={handleApproveAll}
                        className="px-4 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors flex items-center gap-2"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        Approve All Suggestions
                      </button>
                    </div>
                  )}

                  {/* Grouped suggestions */}
                  <div className="space-y-3">
                    {categorizationGroups.map((group, groupIdx) => {
                      const isApproved = approvedGroups.has(groupIdx);
                      const isExpanded = expandedGroups.has(groupIdx);
                      const { isMixed, overrideCount } = getGroupCategoryInfo(group);
                      return (
                        <div
                          key={group.group_key || groupIdx}
                          className={`border rounded-lg transition-all overflow-hidden ${
                            isApproved ? 'bg-gray-50 border-gray-200 opacity-80' : confidenceBg(group.confidence || 0)
                          }`}
                        >
                          {/* Clickable group header */}
                          <div
                            className="p-4 cursor-pointer select-none hover:bg-black/[0.03] transition-colors flex items-start justify-between gap-4"
                            onClick={() => handleToggleGroup(groupIdx)}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                {/* Expand/collapse chevron */}
                                <span className={`text-gray-400 flex-shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-0' : ''}`}>
                                  {isExpanded
                                    ? <ChevronDown className="w-4 h-4" />
                                    : <ChevronRight className="w-4 h-4" />}
                                </span>
                                <span className={`inline-block w-2 h-2 rounded-full ${isApproved ? 'bg-emerald-400' : confidenceDot(group.confidence || 0)}`}></span>
                                <h5 className="font-medium text-gray-800 text-sm truncate">
                                  {group.sample_description || 'Unnamed group'}
                                </h5>
                                <span className="text-xs text-gray-500 whitespace-nowrap">
                                  × {group.transaction_indices?.length || 0} transactions
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
                                    {overrideCount} override{overrideCount !== 1 ? 's' : ''}
                                  </span>
                                )}
                              </div>

                              {/* Suggested category & confidence */}
                              <div className="flex items-center gap-2 text-xs mb-2 ml-6">
                                {group.suggested_category_name && (
                                  <span className={`font-medium ${isApproved ? 'text-emerald-600' : confidenceColor(group.confidence || 0)}`}>
                                    {group.suggested_category_name}
                                  </span>
                                )}
                                {group.confidence != null && (
                                  <span className={`${isApproved ? 'text-gray-400' : confidenceColor(group.confidence || 0)}`}>
                                    ({group.confidence}% confident)
                                  </span>
                                )}
                                {group.match_reason && (
                                  <span className="text-gray-400">— {group.match_reason}</span>
                                )}
                                {isMixed && (
                                  <span className="text-amber-500 italic">(mixed categories)</span>
                                )}
                              </div>

                              {/* Category dropdown — stop propagation so click doesn't toggle expand */}
                              <div className="max-w-xs ml-6" onClick={e => e.stopPropagation()}>
                                <GroupedAccountSelect
                                  accounts={categoryAccounts}
                                  value={group.suggested_category_id || ''}
                                  onChange={e => handleGroupCategoryChange(groupIdx, e.target.value)}
                                  onAddNew={() => handleAddNewAccount({ type: 'group', index: groupIdx })}
                                  placeholder="Select category..."
                                  className="input-field text-sm bg-white shadow-sm"
                                  showCode={false}
                                />
                              </div>
                            </div>

                            {/* Approve button */}
                            <button
                              onClick={(e) => { e.stopPropagation(); handleApproveGroup(groupIdx); }}
                              disabled={isApproved}
                              className={`p-2 rounded-lg transition-colors flex-shrink-0 ${
                                isApproved
                                  ? 'bg-emerald-100 text-emerald-600 cursor-default'
                                  : 'bg-white border border-gray-200 text-gray-400 hover:text-emerald-600 hover:border-emerald-300 hover:bg-emerald-50'
                              }`}
                              title={isApproved ? 'Approved' : 'Approve suggestion'}
                            >
                              <Check className="w-5 h-5" />
                            </button>
                          </div>

                          {/* Expanded individual transactions */}
                          {isExpanded && (
                            <div className="border-t border-gray-200/60 bg-white/60 max-h-[400px] overflow-y-auto">
                              <div className="divide-y divide-gray-100/80">
                                {group.transaction_indices.map(txnIdx => {
                                  const txnData = getTransactionData(txnIdx);
                                  if (!txnData) return null;
                                  const isOverridden = categoryAssignments[txnIdx] && categoryAssignments[txnIdx] !== group.suggested_category_id;
                                  return (
                                    <div
                                      key={txnIdx}
                                      className={`flex items-center gap-3 pl-10 pr-4 py-2 hover:bg-gray-50/80 transition-colors ${
                                        isOverridden ? 'bg-amber-50/30' : ''
                                      }`}
                                    >
                                      <span className="text-gray-400 text-xs w-20 flex-shrink-0">{txnData.date}</span>
                                      <span className="text-gray-700 text-xs truncate flex-1 min-w-0" title={txnData.description}>
                                        {txnData.description}
                                      </span>
                                      {txnData.vendor && (
                                        <span className="text-gray-400 text-[11px] truncate max-w-[6rem] flex-shrink-0">{txnData.vendor}</span>
                                      )}
                                      <span className={`text-xs w-20 text-right font-medium flex-shrink-0 ${
                                        parseFloat(txnData.amount) >= 0 ? 'text-emerald-700' : 'text-gray-800'
                                      }`}>
                                        {txnData.amount}
                                      </span>
                                      <div className="w-44 flex-shrink-0">
                                        <GroupedAccountSelect
                                          accounts={categoryAccounts}
                                          value={categoryAssignments[txnIdx] || ''}
                                          onChange={e => handleIndividualCategoryChange(groupIdx, txnIdx, e.target.value)}
                                          onAddNew={() => handleAddNewAccount({ type: 'grouped-individual', groupIndex: groupIdx, txnIndex: txnIdx })}
                                          placeholder="Category..."
                                          className="input-field text-xs bg-white shadow-sm"
                                          showCode={false}
                                        />
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

                  {/* Ungrouped transactions */}
                  {ungroupedIndices.length > 0 && (
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                        <h5 className="text-sm font-semibold text-gray-700">
                          Ungrouped Transactions ({ungroupedIndices.length})
                        </h5>
                        <p className="text-xs text-gray-500">These didn't match any pattern — assign categories individually.</p>
                      </div>
                      <div className="max-h-[300px] overflow-y-auto divide-y divide-gray-100">
                        {ungroupedIndices.map(txnIdx => {
                          const txn = mappedData[txnIdx];
                          if (!txn) return null;
                          return (
                            <div key={txnIdx} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-800 truncate">{txn.description}</p>
                                <p className="text-xs text-gray-400">{txn.txn_date} · ${Math.abs(txn.amount).toFixed(2)}</p>
                              </div>
                              <div className="w-48 flex-shrink-0">
                                <GroupedAccountSelect
                                  accounts={categoryAccounts}
                                  value={categoryAssignments[txnIdx] || ''}
                                  onChange={e => handleUngroupedCategoryChange(txnIdx, e.target.value)}
                                  onAddNew={() => handleAddNewAccount({ type: 'ungrouped', index: txnIdx })}
                                  placeholder="Category..."
                                  className="input-field text-xs bg-white shadow-sm"
                                  showCode={false}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Empty state */}
                  {categorizationGroups.length === 0 && ungroupedIndices.length === 0 && !loadingCategories && (
                    <div className="text-center py-12 text-gray-400">
                      <p className="text-sm">No categorization suggestions available. You can proceed to preview.</p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ═══ STEP 4: Preview & Import ═══ */}
          {step === 4 && (
            <div className="space-y-6">
              <div className="bg-emerald-50 text-emerald-800 p-4 rounded-lg flex items-center gap-3 border border-emerald-100">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                <p className="font-medium text-sm">Ready to import {mappedData.length} transactions.</p>
              </div>

              {/* Import Summary */}
              <div className="bg-blue-50 text-blue-800 p-4 rounded-lg border border-blue-100">
                <h4 className="font-medium mb-2">Import Settings</h4>
                <div className="text-sm space-y-1">
                  <p>
                    <span className="font-medium">Bank Account:</span>{' '}
                    {bankAccounts.find(ba => ba.id === parseInt(selectedBankAccountId))?.bank_name || 'Unknown'}{' '}
                    {bankAccounts.find(ba => ba.id === parseInt(selectedBankAccountId))?.last_four
                      ? `(...${bankAccounts.find(ba => ba.id === parseInt(selectedBankAccountId))?.last_four})`
                      : ''}
                  </p>
                  <p>
                    <span className="font-medium">Categorized:</span>{' '}
                    {Object.values(categoryAssignments).filter(Boolean).length} of {mappedData.length} transactions have a category assigned
                  </p>
                </div>
              </div>

              <div className="overflow-y-auto max-h-[400px] border border-gray-200 rounded-lg shadow-inner">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b sticky top-0 z-10">
                    <tr>
                      <th className="px-4 py-2 text-left text-gray-500 font-medium w-28">Date</th>
                      <th className="px-4 py-2 text-left text-gray-500 font-medium">Description</th>
                      <th className="px-4 py-2 text-left text-gray-500 font-medium w-40">Category</th>
                      <th className="px-4 py-2 text-right text-gray-500 font-medium w-28">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {mappedData.map((d, i) => {
                      const catId = categoryAssignments[i] || (selectedCategoryId ? parseInt(selectedCategoryId, 10) : null);
                      const catName = getCategoryName(catId);
                      return (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-4 py-2">
                            <span className={d._date_valid ? "text-gray-900" : "text-amber-600 font-medium bg-amber-50 px-1 rounded"}>
                              {d.txn_date}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-gray-700 truncate max-w-xs" title={d.description}>{d.description}</td>
                          <td className="px-4 py-2 text-gray-600 text-xs truncate" title={catName}>
                            {catName || <span className="text-gray-300 italic">None</span>}
                          </td>
                          <td className={`px-4 py-2 text-right font-medium ${d.amount >= 0 ? 'text-emerald-700' : 'text-gray-900'}`}>
                            {d.amount.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-center text-gray-500">
                Transactions will be added to your Inbox review queue. Duplicates will be flagged automatically.
              </p>
            </div>
          )}
        </div>

        {/* Footer controls */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-between items-center rounded-b-xl">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          
          <div className="flex gap-3">
            {step === 2 && (
              <button
                onClick={() => { setError(''); setStep(3); }}
                disabled={!isMappingValid()}
                className="btn-primary"
              >
                Categorize <ChevronRight className="w-4 h-4 ml-1" />
              </button>
            )}
            {step === 3 && (
              <div className="flex gap-2">
                <button onClick={() => { setError(''); setStep(2); }} className="btn-secondary">Back to Mapping</button>
                <button
                  onClick={() => { setError(''); setStep(4); }}
                  disabled={loadingCategories}
                  className="btn-primary"
                >
                  Preview & Import <ChevronRight className="w-4 h-4 ml-1" />
                </button>
              </div>
            )}
            {step === 4 && (
              <div className="flex gap-2">
                <button onClick={() => { setError(''); setStep(3); }} className="btn-secondary">Back to Categorize</button>
                <button onClick={handleImport} disabled={loading} className="btn-primary shadow-lg bg-emerald-600 hover:bg-emerald-700 border-emerald-600 hover:border-emerald-700">
                  {loading ? 'Importing...' : 'Confirm & Import Data'}
                </button>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* ═══ New Account Modal ═══ */}
      {showNewAccountModal && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-primary-600" />
                New Account
              </h3>
              <button
                onClick={handleCancelNewAccount}
                className="p-1.5 text-gray-400 hover:bg-gray-200 rounded-full transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="px-6 py-5 space-y-4">
              {/* Account Name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-gray-700">
                  Account Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newAccountForm.name}
                  onChange={e => setNewAccountForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Office Supplies"
                  className="input-field bg-white shadow-sm"
                  autoFocus
                />
              </div>

              {/* Type */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-gray-700">Type</label>
                <select
                  value={newAccountForm.type}
                  onChange={e => setNewAccountForm(f => ({ ...f, type: e.target.value }))}
                  className="input-field bg-white shadow-sm"
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </div>

              {/* Code (optional) */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-gray-700">
                  Account Code <span className="text-gray-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={newAccountForm.code}
                  onChange={e => setNewAccountForm(f => ({ ...f, code: e.target.value }))}
                  placeholder="e.g. 5200"
                  className="input-field bg-white shadow-sm"
                />
                <p className="text-xs text-gray-500">A short numeric code for the chart of accounts.</p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
              <button
                onClick={handleCancelNewAccount}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveNewAccount}
                disabled={savingNewAccount || !newAccountForm.name.trim()}
                className="btn-primary"
              >
                {savingNewAccount ? 'Saving...' : 'Save Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
