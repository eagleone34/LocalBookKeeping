import { useEffect, useState } from 'react';
import {
  getCompany, updateCompany, getRules, createRule, deleteRule,
  getAccounts, createBackup, getBackups, getBankAccounts, updateBankAccount,
  deleteBackup, previewBackup, exitBackupPreview, restoreBackup,
  getBackupPreviewStatus,
} from '../api/client';
import {
  Save, Trash2, Plus, Shield, Database, BookOpen, Check, Building2,
  CreditCard, Link, Eye, EyeOff, RotateCcw, Clock, AlertTriangle,
  HardDrive, ChevronDown, ChevronUp,
} from 'lucide-react';
import GroupedAccountSelect from '../components/GroupedAccountSelect';
import { useCompany } from '../context/CompanyContext';

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(isoString) {
  if (!isoString) return '—';
  try {
    return new Date(isoString).toLocaleString('en-CA', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return isoString;
  }
}

export default function SettingsPage() {
  const [company, setCompany] = useState(null);
  const [rules, setRules] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [backups, setBackups] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [saved, setSaved] = useState(false);
  const [ruleForm, setRuleForm] = useState({ pattern: '', match_type: 'contains', account_id: '', priority: 10 });
  const [activeTab, setActiveTab] = useState(0);
  const { fetchCompanies } = useCompany();

  // Backup management state
  const [backupLoading, setBackupLoading] = useState(false);
  const [previewStatus, setPreviewStatus] = useState({ preview_active: false, filename: null, created_at: null });
  const [confirmDelete, setConfirmDelete] = useState(null);   // filename to confirm delete
  const [confirmRestore, setConfirmRestore] = useState(null); // filename to confirm restore
  const [actionMsg, setActionMsg] = useState('');

  const load = async () => {
    try {
      const [c, r, a, b, ba, ps] = await Promise.all([
        getCompany(), getRules(), getAccounts(), getBackups(),
        getBankAccounts().catch(() => []),
        getBackupPreviewStatus().catch(() => ({ preview_active: false })),
      ]);
      // Parse existing conversion rate for display in the form
      let usdCadRate = '';
      try {
        const rates = JSON.parse(c.conversion_rates || '{}');
        if (rates.USD_CAD) usdCadRate = String(rates.USD_CAD);
      } catch { /* ignore */ }
      setCompany({ ...c, usdCadRate });
      setRules(r);
      setAccounts(a);
      setBackups(b);
      setBankAccounts(ba);
      setPreviewStatus(ps);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { load(); }, []);

  const handleSaveCompany = async (e) => {
    e.preventDefault();
    const usdCadRate = parseFloat(company.usdCadRate);
    const conversion_rates = !isNaN(usdCadRate) && usdCadRate > 0
      ? JSON.stringify({ USD_CAD: usdCadRate })
      : company.conversion_rates || null;
    await updateCompany({
      name: company.name,
      currency: company.currency,
      fiscal_year_start: company.fiscal_year_start,
      conversion_rates,
    });
    await fetchCompanies();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleAddRule = async (e) => {
    e.preventDefault();
    await createRule({ ...ruleForm, account_id: parseInt(ruleForm.account_id), priority: parseInt(ruleForm.priority) });
    setRuleForm({ pattern: '', match_type: 'contains', account_id: '', priority: 10 });
    load();
  };

  const handleDeleteRule = async (id) => {
    await deleteRule(id);
    load();
  };

  const handleBackup = async () => {
    setBackupLoading(true);
    setActionMsg('');
    try {
      await createBackup();
      setActionMsg('Backup created successfully.');
      load();
    } catch (err) {
      setActionMsg('Backup failed: ' + err.message);
    } finally {
      setBackupLoading(false);
    }
  };

  const handleLinkBankAccount = async (baId, ledgerAccountId) => {
    await updateBankAccount(baId, { ledger_account_id: parseInt(ledgerAccountId) });
    load();
  };

  // ── Backup actions ──────────────────────────────────────────────────────

  const handlePreview = async (filename) => {
    setBackupLoading(true);
    setActionMsg('');
    try {
      await previewBackup(filename);
      setPreviewStatus({ preview_active: true, filename });
      setActionMsg("Preview mode activated. The entire app now shows this backup's data.");
      load();
      // Reload the page so all components re-fetch from the backup DB
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      setActionMsg('Preview failed: ' + err.message);
    } finally {
      setBackupLoading(false);
    }
  };

  const handleExitPreview = async () => {
    setBackupLoading(true);
    setActionMsg('');
    try {
      await exitBackupPreview();
      setPreviewStatus({ preview_active: false, filename: null, created_at: null });
      setActionMsg('Returned to live data.');
      setTimeout(() => window.location.reload(), 500);
    } catch (err) {
      setActionMsg('Failed to exit preview: ' + err.message);
    } finally {
      setBackupLoading(false);
    }
  };

  const handleRestore = async (filename) => {
    setBackupLoading(true);
    setActionMsg('');
    setConfirmRestore(null);
    try {
      await restoreBackup(filename);
      setActionMsg('Database restored! Reloading…');
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setActionMsg('Restore failed: ' + err.message);
    } finally {
      setBackupLoading(false);
    }
  };

  const handleDeleteBackup = async (filename) => {
    setBackupLoading(true);
    setActionMsg('');
    setConfirmDelete(null);
    try {
      await deleteBackup(filename);
      setActionMsg('Backup deleted.');
      load();
    } catch (err) {
      setActionMsg('Delete failed: ' + err.message);
    } finally {
      setBackupLoading(false);
    }
  };

  const tabs = ['Company Info', 'Categorization Rules', 'Bank Accounts', 'Backup &amp; Security'];

  if (!company) return <div className="text-gray-400 dark:text-gray-500">Loading...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Configure your bookkeeping application</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
        {tabs.map((tab, i) => (
          <button key={tab} onClick={() => setActiveTab(i)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
              activeTab === i ? 'border-primary-600 text-primary-700 dark:text-primary-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {i === 0 && <BookOpen className="w-4 h-4" />}
            {i === 1 && <Shield className="w-4 h-4" />}
            {i === 2 && <Building2 className="w-4 h-4" />}
            {i === 3 && <Database className="w-4 h-4" />}
            <span dangerouslySetInnerHTML={{ __html: tab }} />
          </button>
        ))}
      </div>

      {/* Company Info */}
      {activeTab === 0 && (
        <div className="card max-w-2xl">
          <h3 className="text-lg font-semibold mb-4">Company Information</h3>
          <form onSubmit={handleSaveCompany} className="space-y-4">
            <div>
              <label className="label">Company Name</label>
              <input value={company.name} onChange={e => setCompany({...company, name: e.target.value})} className="input-field" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Currency</label>
                <select value={company.currency} onChange={e => setCompany({...company, currency: e.target.value})} className="input-field">
                  <option value="USD">USD - US Dollar</option>
                  <option value="CAD">CAD - Canadian Dollar</option>
                </select>
              </div>
              <div>
                <label className="label">Fiscal Year Starts</label>
                <select value={company.fiscal_year_start} onChange={e => setCompany({...company, fiscal_year_start: parseInt(e.target.value)})} className="input-field">
                  {Array.from({length: 12}, (_, i) => i + 1).map(m => (
                    <option key={m} value={m}>{new Date(2025, m - 1).toLocaleString('en', {month: 'long'})}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="label">
                Exchange Rate
                <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">(1 USD = ? CAD)</span>
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">1 USD =</span>
                <input
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  placeholder="e.g. 1.38"
                  value={company.usdCadRate || ''}
                  onChange={e => setCompany({...company, usdCadRate: e.target.value})}
                  className="input-field w-36"
                />
                <span className="text-sm text-gray-500">CAD</span>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Used to convert amounts between USD and CAD accounts.
              </p>
            </div>
            <button type="submit" className="btn-primary">
              {saved ? <><Check className="w-4 h-4 mr-2" /> Saved!</> : <><Save className="w-4 h-4 mr-2" /> Save Changes</>}
            </button>
          </form>
        </div>
      )}

      {/* Categorization Rules */}
      {activeTab === 1 && (
        <div className="space-y-6">
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Add Categorization Rule</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Rules automatically categorize transactions based on keywords. When a transaction matches a pattern, it gets assigned to the specified account.
              The system also learns from your approvals in the Inbox — every time you approve a transaction, its vendor-to-account mapping is remembered.
            </p>
            <form onSubmit={handleAddRule} className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div>
                <label className="label">Pattern *</label>
                <input value={ruleForm.pattern} onChange={e => setRuleForm({...ruleForm, pattern: e.target.value})} required className="input-field" placeholder="e.g., uber" />
              </div>
              <div>
                <label className="label">Match Type</label>
                <select value={ruleForm.match_type} onChange={e => setRuleForm({...ruleForm, match_type: e.target.value})} className="input-field">
                  <option value="contains">Contains</option>
                  <option value="exact">Exact Match</option>
                  <option value="regex">Regex</option>
                </select>
              </div>
              <div>
                <label className="label">Account *</label>
                <GroupedAccountSelect
                  accounts={accounts}
                  value={ruleForm.account_id}
                  onChange={e => setRuleForm({...ruleForm, account_id: e.target.value})}
                  placeholder="Select account..."
                  required
                />
              </div>
              <div>
                <label className="label">Priority</label>
                <input type="number" value={ruleForm.priority} onChange={e => setRuleForm({...ruleForm, priority: e.target.value})} className="input-field" />
              </div>
              <div className="flex items-end">
                <button type="submit" className="btn-primary"><Plus className="w-4 h-4 mr-1" /> Add Rule</button>
              </div>
            </form>
          </div>

          <div className="card overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-3 px-4 text-left text-gray-500 dark:text-gray-400 font-medium">Pattern</th>
                  <th className="py-3 px-4 text-left text-gray-500 dark:text-gray-400 font-medium">Match Type</th>
                  <th className="py-3 px-4 text-left text-gray-500 dark:text-gray-400 font-medium">Account</th>
                  <th className="py-3 px-4 text-center text-gray-500 dark:text-gray-400 font-medium">Priority</th>
                  <th className="py-3 px-4 text-right text-gray-500 dark:text-gray-400 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map(rule => (
                  <tr key={rule.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="py-3 px-4 font-mono font-medium">{rule.pattern}</td>
                    <td className="py-3 px-4"><span className="badge bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">{rule.match_type}</span></td>
                    <td className="py-3 px-4">{rule.account_name}</td>
                    <td className="py-3 px-4 text-center">{rule.priority}</td>
                    <td className="py-3 px-4 text-right">
                      <button onClick={() => handleDeleteRule(rule.id)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 dark:text-gray-500 hover:text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rules.length === 0 && <div className="p-8 text-center text-gray-400 dark:text-gray-500">No rules yet. Add your first categorization rule above.</div>}
          </div>
        </div>
      )}

      {/* Bank Accounts */}
      {activeTab === 2 && (
        <div className="space-y-6">
          <div className="card">
            <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-primary-600" />
              Linked Bank Accounts
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              When you upload a bank statement PDF, the system automatically detects the bank name and account number (last 4 digits).
              Link each detected bank account to your Chart of Accounts so future uploads auto-map correctly.
            </p>
            {bankAccounts.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
                      <th className="py-3 px-4 text-left text-gray-500 dark:text-gray-400 font-medium">Bank</th>
                      <th className="py-3 px-4 text-left text-gray-500 dark:text-gray-400 font-medium">Account</th>
                      <th className="py-3 px-4 text-left text-gray-500 dark:text-gray-400 font-medium">Nickname</th>
                      <th className="py-3 px-4 text-left text-gray-500 dark:text-gray-400 font-medium w-64">Linked Ledger Account</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bankAccounts.map(ba => (
                      <tr key={ba.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="py-3 px-4">
                          <span className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-blue-500" />
                            <span className="font-medium">{ba.bank_name}</span>
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="flex items-center gap-1">
                            <CreditCard className="w-4 h-4 text-gray-400" />
                            ****{ba.last_four}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-gray-500 dark:text-gray-400">{ba.nickname || '-'}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <Link className="w-4 h-4 text-gray-400" />
                            <GroupedAccountSelect
                              accounts={accounts.filter(a => a.type === 'asset')}
                              value={ba.ledger_account_id || ''}
                              onChange={e => handleLinkBankAccount(ba.id, e.target.value)}
                              placeholder="Link to ledger account..."
                              className="input-field text-sm py-1"
                            />
                          </div>
                          {ba.ledger_account_name && (
                            <span className="text-xs text-emerald-600 ml-6">Currently: {ba.ledger_account_name}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-700 rounded-lg">
                No bank accounts detected yet. Upload a bank statement PDF in the Inbox to auto-detect bank accounts.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Backup & Security */}
      {activeTab === 3 && (
        <div className="space-y-6">

          {/* Action message */}
          {actionMsg && (
            <div className={`px-4 py-3 rounded-lg text-sm font-medium flex items-center gap-2 ${
              actionMsg.toLowerCase().includes('fail') || actionMsg.toLowerCase().includes('error')
                ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
                : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
            }`}>
              <Check className="w-4 h-4 flex-shrink-0" />
              {actionMsg}
            </div>
          )}

          {/* Preview mode notice (within settings) */}
          {previewStatus.preview_active && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 flex items-center gap-3">
              <Eye className="w-5 h-5 text-amber-600 flex-shrink-0" />
              <div className="flex-1 text-sm text-amber-800 dark:text-amber-300">
                <span className="font-semibold">Preview Mode Active</span> — you are viewing backup{' '}
                <span className="font-mono text-xs bg-amber-100 px-1 rounded">{previewStatus.filename}</span>.
                All pages show this backup&apos;s data. Your live data is untouched.
              </div>
              <button
                onClick={handleExitPreview}
                disabled={backupLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-sm font-semibold hover:bg-amber-700 transition-colors"
              >
                <EyeOff className="w-4 h-4" />
                Exit Preview
              </button>
            </div>
          )}

          {/* Create Backup */}
          <div className="card max-w-2xl">
            <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
              <Database className="w-5 h-5 text-primary-600" />
              Create Backup
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Create a snapshot of your entire database. Backups are stored locally alongside your data.
              You can preview any backup before restoring it.
            </p>
            <button
              onClick={handleBackup}
              disabled={backupLoading}
              className="btn-primary"
            >
              <Database className="w-4 h-4 mr-2" />
              {backupLoading ? 'Working…' : 'Create Backup Now'}
            </button>
          </div>

          {/* Backup List */}
          {backups.length > 0 && (
            <div className="card max-w-4xl">
              <h4 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-4 flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-gray-500" />
                Available Backups
                <span className="ml-1 text-xs font-normal text-gray-400">({backups.length})</span>
              </h4>

              <div className="space-y-3">
                {backups.map((b) => {
                  const isCurrentPreview = previewStatus.preview_active && previewStatus.filename === b.filename;
                  const isConfirmingDelete = confirmDelete === b.filename;
                  const isConfirmingRestore = confirmRestore === b.filename;

                  return (
                    <div
                      key={b.filename}
                      className={`rounded-lg border px-4 py-3 transition-colors ${
                        isCurrentPreview
                          ? 'border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700'
                          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        {/* Icon + info */}
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <Database className={`w-5 h-5 flex-shrink-0 ${isCurrentPreview ? 'text-amber-500' : 'text-gray-400'}`} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs text-gray-600 dark:text-gray-400 truncate">{b.filename}</span>
                              {isCurrentPreview && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-200 text-amber-800 text-xs font-semibold">
                                  <Eye className="w-3 h-3" /> Previewing
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatDate(b.created_at)}
                              </span>
                              <span>{formatBytes(b.size)}</span>
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {isConfirmingRestore ? (
                            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5">
                              <AlertTriangle className="w-4 h-4 text-blue-600" />
                              <span className="text-xs font-semibold text-blue-800">Replace live data?</span>
                              <button
                                onClick={() => handleRestore(b.filename)}
                                disabled={backupLoading}
                                className="px-2 py-1 bg-blue-600 text-white rounded text-xs font-bold hover:bg-blue-700 transition-colors"
                              >
                                {backupLoading ? '…' : 'Yes, Restore'}
                              </button>
                              <button
                                onClick={() => setConfirmRestore(null)}
                                className="px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs font-medium hover:bg-gray-300 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : isConfirmingDelete ? (
                            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                              <AlertTriangle className="w-4 h-4 text-red-600" />
                              <span className="text-xs font-semibold text-red-800">Delete permanently?</span>
                              <button
                                onClick={() => handleDeleteBackup(b.filename)}
                                disabled={backupLoading}
                                className="px-2 py-1 bg-red-600 text-white rounded text-xs font-bold hover:bg-red-700 transition-colors"
                              >
                                {backupLoading ? '…' : 'Delete'}
                              </button>
                              <button
                                onClick={() => setConfirmDelete(null)}
                                className="px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs font-medium hover:bg-gray-300 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <>
                              {/* Preview / Exit Preview */}
                              {isCurrentPreview ? (
                                <button
                                  onClick={handleExitPreview}
                                  disabled={backupLoading}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-100 text-amber-800 hover:bg-amber-200 transition-colors"
                                  title="Return to live data"
                                >
                                  <EyeOff className="w-4 h-4" />
                                  Exit Preview
                                </button>
                              ) : (
                                <button
                                  onClick={() => handlePreview(b.filename)}
                                  disabled={backupLoading || previewStatus.preview_active}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 hover:text-primary-700 dark:hover:text-primary-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                  title={previewStatus.preview_active ? 'Exit current preview first' : 'Browse this backup across the whole app'}
                                >
                                  <Eye className="w-4 h-4" />
                                  Preview
                                </button>
                              )}

                              {/* Restore */}
                              <button
                                onClick={() => setConfirmRestore(b.filename)}
                                disabled={backupLoading}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-40"
                                title="Restore this backup as your live database"
                              >
                                <RotateCcw className="w-4 h-4" />
                                Restore
                              </button>

                              {/* Delete */}
                              <button
                                onClick={() => setConfirmDelete(b.filename)}
                                disabled={backupLoading || isCurrentPreview}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                title={isCurrentPreview ? 'Exit preview before deleting' : 'Permanently delete this backup'}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {backups.length === 0 && (
            <div className="card max-w-2xl p-8 text-center text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-700">
              <Database className="w-10 h-10 mx-auto mb-2 text-gray-300" />
              <p>No backups yet. Create your first backup above.</p>
            </div>
          )}

          {/* Security info */}
          <div className="card max-w-2xl">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary-600" />
              Security &amp; Privacy
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-3 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                <Check className="w-5 h-5 text-emerald-600 mt-0.5" />
                <div>
                  <p className="font-medium text-emerald-800 dark:text-emerald-400">Local-First Storage</p>
                  <p className="text-emerald-600 dark:text-emerald-500">All your data is stored locally on your machine. Nothing is sent to the cloud.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                <Check className="w-5 h-5 text-emerald-600 mt-0.5" />
                <div>
                  <p className="font-medium text-emerald-800 dark:text-emerald-400">Smart Learning</p>
                  <p className="text-emerald-600 dark:text-emerald-500">The system learns from your categorization decisions and gets smarter with each statement you process.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                <Check className="w-5 h-5 text-emerald-600 mt-0.5" />
                <div>
                  <p className="font-medium text-emerald-800 dark:text-emerald-400">SQLite with WAL Mode</p>
                  <p className="text-emerald-600 dark:text-emerald-500">Your database uses Write-Ahead Logging for data integrity and crash recovery.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <Shield className="w-5 h-5 text-blue-600 mt-0.5" />
                <div>
                  <p className="font-medium text-blue-800 dark:text-blue-400">Backup &amp; Preview</p>
                  <p className="text-blue-600 dark:text-blue-500">Create backups at any time. Use Preview to browse a backup across the whole app before committing to a restore.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
