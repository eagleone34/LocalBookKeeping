const BASE = import.meta.env.DEV ? 'http://localhost:8000' : '';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

// Dashboard
export const getDashboard = () => request('/api/reports/dashboard');

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

// Reports
export const getPnL = (dateFrom, dateTo) => {
  const qs = new URLSearchParams();
  if (dateFrom) qs.set('date_from', dateFrom);
  if (dateTo) qs.set('date_to', dateTo);
  return request(`/api/reports/pnl?${qs}`);
};
export const getBudgetVsActual = (month) => {
  const qs = month ? `?month=${month}` : '';
  return request(`/api/reports/budget-vs-actual${qs}`);
};
export const getExpenseByCategory = (dateFrom, dateTo) => {
  const qs = new URLSearchParams();
  if (dateFrom) qs.set('date_from', dateFrom);
  if (dateTo) qs.set('date_to', dateTo);
  return request(`/api/reports/expense-by-category?${qs}`);
};
export const getExpenseByVendor = (dateFrom, dateTo) => {
  const qs = new URLSearchParams();
  if (dateFrom) qs.set('date_from', dateFrom);
  if (dateTo) qs.set('date_to', dateTo);
  return request(`/api/reports/expense-by-vendor?${qs}`);
};
export const getMonthlyTrend = (months = 12) =>
  request(`/api/reports/monthly-trend?months=${months}`);
export const getBalanceSheet = () =>
  request('/api/reports/balance-sheet');

// Documents
export const getDocuments = () => request('/api/documents');
export const uploadDocuments = async (files) => {
  const form = new FormData();
  files.forEach(f => form.append('files', f));
  const res = await fetch(`${BASE}/api/documents/upload`, { method: 'POST', body: form });
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

// Settings
export const getCompany = () => request('/api/company');
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
