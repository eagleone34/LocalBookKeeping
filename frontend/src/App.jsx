import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import AccountLedger from './pages/AccountLedger';
import Reconciliation from './pages/Reconciliation';
import Transactions from './pages/Transactions';
import Budgets from './pages/Budgets';
import Reports from './pages/Reports';
import Inbox from './pages/Inbox';
import SettingsPage from './pages/Settings';

export default function App() {
  useEffect(() => {
    const id = setInterval(() => {
      fetch('/api/heartbeat').catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/accounts/:accountId/ledger" element={<AccountLedger />} />
          <Route path="/reconciliation/:bankAccountId" element={<Reconciliation />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/budgets" element={<Budgets />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
