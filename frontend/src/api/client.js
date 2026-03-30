const BASE = '';

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const companyId = localStorage.getItem('company_id');
  if (companyId) {
    headers['X-Company-Id'] = companyId;
  }
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

// Dashboard
export const getDashboard = (dateFrom, dateTo) => {
  const qs = new URLSearchParams();
  if (dateFrom) qs.set('date_from', dateFrom);
  if (dateTo) qs.set('date_to', dateTo);
  return request(`/api/reports/dashboard?${qs}`);
};

// Accounts
export const getAccounts = (includeInactive = false) =>
  request(`/api/accounts?include_inactive=${includeInactive}`);
export const createAccount = (data) =>
  request('/api/accounts', { method: 'POST', body: JSON.stringify(data) });
export const updateAccount = (id, data) =>
  request(`/api/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const archiveAccount = (id) =>
  request(`/api/accounts/${id}/archive`, { method: 'POST' });
export const restoreAccount = (id) =>
  request(`/api/accounts/${id}/restore`, { method: 'POST' });
export const deleteAccount = (id) =>
  request(`/api/accounts/${id}`, { method: 'DELETE' });
export const getAccountTransactionCount = (id) =>
  request(`/api/accounts/${id}/transaction-count`);
export const getAccountBalance = (id) =>
  request(`/api/accounts/${id}/balance`);
export const getAllAccountBalances = () =>
  request('/api/accounts/balances/all');
export const getAccountLedger = (id, dateFrom, dateTo) => {
  const qs = new URLSearchParams();
  if (dateFrom) qs.set('date_from', dateFrom);
  if (dateTo) qs.set('date_to', dateTo);
  const q = qs.toString();
  return request(`/api/accounts/${id}/ledger${q ? '?' + q : ''}`);
};

// Transactions
export const getTransactions = (params = {}) => {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') qs.set(k, v); });
  return request(`/api/transactions?${qs}`);
};
export const createTransaction = (data) =>
  request('/api/transactions', { method: 'POST', body: JSON.stringify(data) });
export const updateTransaction = (id, data) =>
  request(`/api/transactions/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteTransaction = (id) =>
  request(`/api/transactions/${id}`, { method: 'DELETE' });
export const bulkRecategorize = (data) =>
  request('/api/transactions/bulk-recategorize', { method: 'POST', body: JSON.stringify(data) });

// Budgets
export const getBudgets = (month) => {
  const qs = month ? `?month=${month}` : '';
  return request(`/api/budgets${qs}`);
};
export const upsertBudget = (data) =>
  request('/api/budgets', { method: 'POST', body: JSON.stringify(data) });
export const deleteBudget = (id) =>
  request(`/api/budgets/${id}`, { method: 'DELETE' });

export const getBudgetSummary = (startDate, endDate, accountId) => {
  const qs = new URLSearchParams();
  if (startDate) qs.set('start_date', startDate);
  if (endDate)   qs.set('end_date',   endDate);
  if (accountId) qs.set('account_id', accountId);
  const q = qs.toString();
  return request(`/api/budgets/summary${q ? '?' + q : ''}`);
};

// Reports
export const getPnL = (dateFrom, dateTo, bankAccountId) => {
  const qs = new URLSearchParams();
  if (dateFrom) qs.set('date_from', dateFrom);
  if (dateTo) qs.set('date_to', dateTo);
  if (bankAccountId) qs.set('bank_account_id', bankAccountId);
  return request(`/api/reports/pnl?${qs}`);
};
export const getBudgetVsActual = (monthFrom, monthTo, accountId) => {
  const qs = new URLSearchParams();
  if (monthFrom) qs.set('month_from', monthFrom);
  if (monthTo)   qs.set('month_to',   monthTo);
  if (accountId) qs.set('account_id', accountId);
  const q = qs.toString();
  return request(`/api/reports/budget-vs-actual${q ? '?' + q : ''}`);
};
export const getExpenseByCategory = (dateFrom, dateTo, bankAccountId) => {
  const qs = new URLSearchParams();
  if (dateFrom) qs.set('date_from', dateFrom);
  if (dateTo) qs.set('date_to', dateTo);
  if (bankAccountId) qs.set('bank_account_id', bankAccountId);
  return request(`/api/reports/expense-by-category?${qs}`);
};
export const getExpenseByVendor = (dateFrom, dateTo, bankAccountId) => {
  const qs = new URLSearchParams();
  if (dateFrom) qs.set('date_from', dateFrom);
  if (dateTo) qs.set('date_to', dateTo);
  if (bankAccountId) qs.set('bank_account_id', bankAccountId);
  return request(`/api/reports/expense-by-vendor?${qs}`);
};
export const getMonthlyTrend = (months = 12, bankAccountId) => {
  const qs = new URLSearchParams();
  qs.set('months', months);
  if (bankAccountId) qs.set('bank_account_id', bankAccountId);
  return request(`/api/reports/monthly-trend?${qs}`);
};
export const getBalanceSheet = () =>
  request('/api/reports/balance-sheet');

// Documents
export const getDocuments = () => request('/api/documents');
export const uploadDocuments = async (files) => {
  const form = new FormData();
  files.forEach(f => form.append('files', f));
  const headers = {};
  const companyId = localStorage.getItem('company_id');
  if (companyId) {
    headers['X-Company-Id'] = companyId;
  }
  const res = await fetch(`${BASE}/api/documents/upload`, { method: 'POST', body: form, headers });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
};
export const getDocTransactions = (docId, status) => {
  const qs = new URLSearchParams();
  if (docId) qs.set('doc_id', docId);
  if (status) qs.set('status', status);
  return request(`/api/documents/transactions?${qs}`);
};
export const actionDocTransaction = (id, data) =>
  request(`/api/documents/transactions/${id}/action`, { method: 'POST', body: JSON.stringify(data) });
export const bulkDocAction = (data) =>
  request('/api/documents/transactions/bulk-action', { method: 'POST', body: JSON.stringify(data) });
export const deleteDocument = (id) =>
  request(`/api/documents/${id}`, { method: 'DELETE' });
export const deleteDocTransaction = (id) =>
  request(`/api/documents/transactions/${id}`, { method: 'DELETE' });

// Settings
export const getCompany = () => request('/api/company');
export const getCompanies = () => request('/api/companies');
export const createCompanyRecord = (data) =>
  request('/api/companies', { method: 'POST', body: JSON.stringify(data) });
export const deleteCompanyRecord = (id) =>
  request(`/api/companies/${id}`, { method: 'DELETE' });
export const updateCompany = (data) =>
  request('/api/company', { method: 'PUT', body: JSON.stringify(data) });
export const getVendors = () => request('/api/vendors');
export const getRules = () => request('/api/rules');
export const createRule = (data) =>
  request('/api/rules', { method: 'POST', body: JSON.stringify(data) });
export const deleteRule = (id) =>
  request(`/api/rules/${id}`, { method: 'DELETE' });
export const createBackup = () =>
  request('/api/backup', { method: 'POST' });
export const getBackups = () => request('/api/backups');
export const deleteBackup = (filename) =>
  request(`/api/backups/${encodeURIComponent(filename)}`, { method: 'DELETE' });
export const previewBackup = (filename) =>
  request(`/api/backups/${encodeURIComponent(filename)}/preview`, { method: 'POST' });
export const exitBackupPreview = () =>
  request('/api/backup-preview/exit', { method: 'POST' });
export const restoreBackup = (filename) =>
  request(`/api/backups/${encodeURIComponent(filename)}/restore`, { method: 'POST' });
export const getBackupPreviewStatus = () =>
  request('/api/backup-preview-status');

export const getBankAccounts = () => request('/api/accounts/bank-accounts');
export const createBankAccount = (data) =>
  request('/api/accounts/bank-accounts', { method: 'POST', body: JSON.stringify(data) });
export const updateBankAccount = (id, data) =>
  request(`/api/accounts/bank-accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const importMappedCsv = (data) =>
  request('/api/documents/import-csv', { method: 'POST', body: JSON.stringify(data) });

// Smart categorization
export const suggestCategories = (data) =>
  request('/api/transactions/suggest-categories', { method: 'POST', body: JSON.stringify(data) });

// Update
export const triggerUpdate = () =>
  request('/api/update/install', { method: 'POST' });

// Reconciliation
export const getReconciliationStatus = (bankAccountId) =>
  request(`/api/reconciliation/${bankAccountId}/status`);
export const getBalanceAsOf = (bankAccountId, date) =>
  request(`/api/reconciliation/${bankAccountId}/balance-as-of?date=${date}`);
export const saveReconciliation = (bankAccountId, data) =>
  request(`/api/reconciliation/${bankAccountId}`, { method: 'POST', body: JSON.stringify(data) });
export const getReconciliationHistory = (bankAccountId) =>
  request(`/api/reconciliation/${bankAccountId}/history`);
