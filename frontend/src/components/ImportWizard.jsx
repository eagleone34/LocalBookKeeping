import React, { useState, useRef, useMemo } from 'react';
import { X, UploadCloud, CheckCircle2, ChevronRight, FileSpreadsheet, AlertCircle } from 'lucide-react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { parse, isValid, parseISO } from 'date-fns';
import { importMappedCsv } from '../api/client';

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

export default function ImportWizard({ onClose, onSuccess }) {
  const [step, setStep] = useState(1); // 1: Upload, 2: Map, 3: Preview
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  
  // Mapping logic: { date: 'colName', description: 'colName', ... }
  const [mapping, setMapping] = useState({});

  const fileInputRef = useRef();

  const handleFileChange = (e) => {
    const f = e.target.files[0];
    if (f) processFile(f);
  };

  const processFile = async (f) => {
    setError('');
    setLoading(true);
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
            const workbook = XLSX.read(data, { type: 'binary', cellDates: true });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(firstSheet, { raw: false, dateNF: 'yyyy-mm-dd' });
            
            if (json.length === 0) {
              setError("Spreadsheet appears to be empty.");
              setLoading(false);
              return;
            }
            
            const cols = Object.keys(json[0]);
            setHeaders(cols);
            setRows(json);
            setFile(f);
            autoMap(cols);
            setStep(2);
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

  const autoMap = (availableHeaders) => {
    const m = {};
    const lower = availableHeaders.map(h => h.toLowerCase().trim());
    
    // Date
    let idx = lower.findIndex(h => h.includes('date') || h.includes('posted') || h.includes('txn'));
    if (idx !== -1) m.date = availableHeaders[idx];
    
    // Description
    idx = lower.findIndex(h => h.includes('description') || h.includes('memo') || h.includes('payee') || h.includes('name'));
    if (idx !== -1) m.description = availableHeaders[idx];
    
    // Amount
    idx = lower.findIndex(h => h.includes('amount') || h.includes('value'));
    if (idx !== -1) {
      m.amount = availableHeaders[idx];
    } else {
      // Sometimes it's debit/credit. For simplicity we prioritize anything obvious.
      const deb = availableHeaders.find(h => h.toLowerCase().includes('debit') || h.toLowerCase().includes('out'));
      if (deb) m.amount = deb;
    }
    
    // Vendor/Payee (optional)
    idx = lower.findIndex(h => h === 'payee' || h === 'vendor' || h === 'merchant');
    if (idx !== -1 && availableHeaders[idx] !== m.description) {
      m.vendor = availableHeaders[idx];
    }
    
    setMapping(m);
  };

  const isMappingValid = () => {
    return REQUIRED_FIELDS.filter(f => f.required).every(f => mapping[f.id]);
  };

  const mappedData = useMemo(() => {
    if (step < 3) return [];
    
    return rows.map((row) => {
      const dateRaw = row[mapping.date];
      const descRaw = row[mapping.description] || "";
      const amtRaw = row[mapping.amount] || 0;
      const vendorRaw = mapping.vendor ? row[mapping.vendor] : "";
      
      const parsedDate = tryParseDate(dateRaw);
      
      return {
        _raw_date: dateRaw,
        txn_date: parsedDate || new Date().toISOString().slice(0,10),
        _date_valid: parsedDate !== null,
        description: String(descRaw),
        amount: parseAmount(amtRaw),
        vendor_name: String(vendorRaw),
      };
    }).filter(r => r.description.trim() !== '' && r.amount !== 0); // basic filter
  }, [rows, mapping, step]);


  const handleImport = async () => {
    try {
      setLoading(true);
      setError('');
      
      const payload = {
        filename: file.name,
        transactions: mappedData.map(d => ({
          txn_date: d.txn_date,
          description: d.description,
          amount: d.amount,
          vendor_name: d.vendor_name
        }))
      };
      
      await importMappedCsv(payload);
      setLoading(false);
      onSuccess();
    } catch (e) {
      setError("Import failed: " + e.message);
      setLoading(false);
    }
  };

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
            <span className={`px-2.5 py-1 rounded-full ${step >= 1 ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-400'}`}>1. Upload</span>
            <ChevronRight className="w-4 h-4 text-gray-300" />
            <span className={`px-2.5 py-1 rounded-full ${step >= 2 ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-400'}`}>2. Map Columns</span>
            <ChevronRight className="w-4 h-4 text-gray-300" />
            <span className={`px-2.5 py-1 rounded-full ${step >= 3 ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-400'}`}>3. Preview & Import</span>
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

          {step === 2 && (
            <div className="space-y-6">
              <p className="text-gray-600">Please map the core fields required for LocalBooks to the columns found in <strong>{file?.name}</strong>.</p>
              
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {REQUIRED_FIELDS.map(f => (
                    <div key={f.id} className="flex flex-col gap-1.5">
                      <label className="text-sm font-semibold text-gray-700">
                        {f.label} {f.required && <span className="text-red-500">*</span>}
                      </label>
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
                          <td className="px-4 py-3 text-right">{mapping.amount ? String(r[mapping.amount]) : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div className="bg-emerald-50 text-emerald-800 p-4 rounded-lg flex items-center gap-3 border border-emerald-100">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                <p className="font-medium text-sm">Mapped successfully. Found {mappedData.length} valid transactions to import.</p>
              </div>

              <div className="overflow-y-auto max-h-[400px] border border-gray-200 rounded-lg shadow-inner">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b sticky top-0 z-10">
                    <tr>
                      <th className="px-4 py-2 text-left text-gray-500 font-medium w-32">Parsed Date</th>
                      <th className="px-4 py-2 text-left text-gray-500 font-medium w-48 hidden md:table-cell">Raw Date Data</th>
                      <th className="px-4 py-2 text-left text-gray-500 font-medium">Description</th>
                      <th className="px-4 py-2 text-right text-gray-500 font-medium w-32">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {mappedData.map((d, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-2">
                          <span className={d._date_valid ? "text-gray-900" : "text-amber-600 font-medium bg-amber-50 px-1 rounded"}>
                            {d.txn_date}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-400 hidden md:table-cell truncate" title={d._raw_date}>{d._raw_date}</td>
                        <td className="px-4 py-2 text-gray-700 truncate max-w-xs" title={d.description}>{d.description}</td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900">{d.amount.toFixed(2)}</td>
                      </tr>
                    ))}
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
                onClick={() => setStep(3)} 
                disabled={!isMappingValid()} 
                className="btn-primary"
              >
                Review & Prev <ChevronRight className="w-4 h-4 ml-1" />
              </button>
            )}
            {step === 3 && (
              <div className="flex gap-2">
                <button onClick={() => setStep(2)} className="btn-secondary">Back to Mapping</button>
                <button onClick={handleImport} disabled={loading} className="btn-primary shadow-lg bg-emerald-600 hover:bg-emerald-700 border-emerald-600 hover:border-emerald-700">
                  {loading ? 'Importing...' : 'Confirm & Import Data'}
                </button>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
