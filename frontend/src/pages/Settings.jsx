import { useEffect, useState } from 'react';
import {
  getCompany, updateCompany, getRules, createRule, deleteRule,
  getAccounts, createBackup, getBackups, getBankAccounts, updateBankAccount,
} from '../api/client';
import { Save, Trash2, Plus, Shield, Database, BookOpen, Check, Building2, CreditCard, Link } from 'lucide-react';
import GroupedAccountSelect from '../components/GroupedAccountSelect';
import { useCompany } from '../context/CompanyContext';

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

  const load = async () => {
    try {
      const [c, r, a, b, ba] = await Promise.all([
        getCompany(), getRules(), getAccounts(), getBackups(), getBankAccounts().catch(() => []),
      ]);
      setCompany(c);
      setRules(r);
      setAccounts(a);
      setBackups(b);
      setBankAccounts(ba);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { load(); }, []);

  const handleSaveCompany = async (e) => {
    e.preventDefault();
    await updateCompany({ name: company.name, currency: company.currency, fiscal_year_start: company.fiscal_year_start });
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
    await createBackup();
    load();
  };

  const handleLinkBankAccount = async (baId, ledgerAccountId) => {
    await updateBankAccount(baId, { ledger_account_id: parseInt(ledgerAccountId) });
    load();
  };

  const tabs = ['Company Info', 'Categorization Rules', 'Bank Accounts', 'Backup & Security'];

  if (!company) return <div className="text-gray-400">Loading...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">Configure your bookkeeping application</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {tabs.map((tab, i) => (
          <button key={tab} onClick={() => setActiveTab(i)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
              activeTab === i ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {i === 0 && <BookOpen className="w-4 h-4" />}
            {i === 1 && <Shield className="w-4 h-4" />}
            {i === 2 && <Building2 className="w-4 h-4" />}
            {i === 3 && <Database className="w-4 h-4" />}
            {tab}
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
                  <option value="EUR">EUR - Euro</option>
                  <option value="GBP">GBP - British Pound</option>
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
            <p className="text-sm text-gray-500 mb-4">
              Rules automatically categorize transactions based on keywords. When a transaction matches a pattern, it gets assigned to the specified account.
              The system also learns from your approvals in the Inbox -- every time you approve a transaction, its vendor-to-account mapping is remembered.
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
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="py-3 px-4 text-left text-gray-500 font-medium">Pattern</th>
                  <th className="py-3 px-4 text-left text-gray-500 font-medium">Match Type</th>
                  <th className="py-3 px-4 text-left text-gray-500 font-medium">Account</th>
                  <th className="py-3 px-4 text-center text-gray-500 font-medium">Priority</th>
                  <th className="py-3 px-4 text-right text-gray-500 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map(rule => (
                  <tr key={rule.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4 font-mono font-medium">{rule.pattern}</td>
                    <td className="py-3 px-4"><span className="badge bg-gray-100 text-gray-600">{rule.match_type}</span></td>
                    <td className="py-3 px-4">{rule.account_name}</td>
                    <td className="py-3 px-4 text-center">{rule.priority}</td>
                    <td className="py-3 px-4 text-right">
                      <button onClick={() => handleDeleteRule(rule.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rules.length === 0 && <div className="p-8 text-center text-gray-400">No rules yet. Add your first categorization rule above.</div>}
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
            <p className="text-sm text-gray-500 mb-4">
              When you upload a bank statement PDF, the system automatically detects the bank name and account number (last 4 digits).
              Link each detected bank account to your Chart of Accounts so future uploads auto-map correctly.
            </p>
            {bankAccounts.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="py-3 px-4 text-left text-gray-500 font-medium">Bank</th>
                      <th className="py-3 px-4 text-left text-gray-500 font-medium">Account</th>
                      <th className="py-3 px-4 text-left text-gray-500 font-medium">Nickname</th>
                      <th className="py-3 px-4 text-left text-gray-500 font-medium w-64">Linked Ledger Account</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bankAccounts.map(ba => (
                      <tr key={ba.id} className="border-b border-gray-100 hover:bg-gray-50">
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
                        <td className="py-3 px-4 text-gray-500">{ba.nickname || '-'}</td>
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
              <div className="p-8 text-center text-gray-400 bg-gray-50 rounded-lg">
                No bank accounts detected yet. Upload a bank statement PDF in the Inbox to auto-detect bank accounts.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Backup & Security */}
      {activeTab === 3 && (
        <div className="space-y-6">
          <div className="card max-w-2xl">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Database className="w-5 h-5 text-primary-600" />
              Backup
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              Create a backup of your entire database. Backups are stored alongside your data.
            </p>
            <button onClick={handleBackup} className="btn-primary">
              <Database className="w-4 h-4 mr-2" /> Create Backup Now
            </button>

            {backups.length > 0 && (
              <div className="mt-6">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Available Backups</h4>
                <ul className="space-y-2">
                  {backups.map(b => (
                    <li key={b.filename} className="flex items-center gap-3 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                      <Database className="w-4 h-4 text-gray-400" />
                      <span className="font-mono">{b.filename}</span>
                      <span className="text-gray-400">{(b.size / 1024).toFixed(0)} KB</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="card max-w-2xl">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary-600" />
              Security & Privacy
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-3 p-3 bg-emerald-50 rounded-lg">
                <Check className="w-5 h-5 text-emerald-600 mt-0.5" />
                <div>
                  <p className="font-medium text-emerald-800">Local-First Storage</p>
                  <p className="text-emerald-600">All your data is stored locally on your machine. Nothing is sent to the cloud.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-emerald-50 rounded-lg">
                <Check className="w-5 h-5 text-emerald-600 mt-0.5" />
                <div>
                  <p className="font-medium text-emerald-800">Smart Learning</p>
                  <p className="text-emerald-600">The system learns from your categorization decisions and gets smarter with each statement you process.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-emerald-50 rounded-lg">
                <Check className="w-5 h-5 text-emerald-600 mt-0.5" />
                <div>
                  <p className="font-medium text-emerald-800">SQLite with WAL Mode</p>
                  <p className="text-emerald-600">Your database uses Write-Ahead Logging for data integrity and crash recovery.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
                <Shield className="w-5 h-5 text-blue-600 mt-0.5" />
                <div>
                  <p className="font-medium text-blue-800">Manual Backups</p>
                  <p className="text-blue-600">Create backups at any time. Keep copies on an external drive for safety.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
