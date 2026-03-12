import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard, BookOpen, ArrowLeftRight, PiggyBank,
  BarChart3, FileText, Settings, Inbox, Building2, Plus, Trash2, AlertCircle
} from 'lucide-react';
import { useCompany } from '../context/CompanyContext';
import { useState, useEffect } from 'react';
import api from '../api/client';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/accounts', icon: BookOpen, label: 'Accounts' },
  { to: '/transactions', icon: ArrowLeftRight, label: 'Transactions' },
  { to: '/budgets', icon: PiggyBank, label: 'Budgets' },
  { to: '/reports', icon: BarChart3, label: 'Reports' },
  { to: '/inbox', icon: Inbox, label: 'Statement Inbox' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function Layout() {
  const { companies, currentCompany, switchCompany, createCompany, deleteCompany, loading } = useCompany();
  const [updateInfo, setUpdateInfo] = useState({ available: false, version: null });

  useEffect(() => {
    api.get('/health/update')
      .then(res => {
        if (res.data && res.data.update_available) {
          setUpdateInfo({ available: true, version: res.data.latest_version });
        }
      })
      .catch(err => console.error("Failed to check for updates:", err));
  }, []);

  const handleCompanyChange = async (e) => {
    const val = e.target.value;
    if (val === 'CREATE_NEW') {
      const name = window.prompt("Enter new company name:");
      if (name && name.trim()) {
        try {
          await createCompany(name.trim());
        } catch (err) {
          alert('Failed to create company.');
          e.target.value = currentCompany.id;
        }
      } else {
        e.target.value = currentCompany.id;
      }
    } else if (val === 'DELETE_CURRENT') {
      e.target.value = currentCompany.id;
      const confirmed = window.confirm(
        `Are you sure you want to permanently delete "${currentCompany.name}" and ALL of its data?\n\nThis action cannot be undone.`
      );
      if (confirmed) {
        try {
          await deleteCompany(currentCompany.id);
        } catch (err) {
          alert(err.message || 'Failed to delete company.');
        }
      }
    } else {
      const selected = companies.find(c => c.id === parseInt(val, 10));
      if (selected) {
        switchCompany(selected);
      }
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-xl font-bold text-primary-700 flex items-center gap-2 mb-4 px-2">
            <BookOpen className="w-6 h-6" />
            LocalBooks
          </h1>

          {!loading && companies.length > 0 && currentCompany && (
            <div className="relative dropdown-container">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Building2 className="h-4 w-4 text-gray-500" />
              </div>
              <select
                className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 block p-2.5 pl-9 font-medium"
                value={currentCompany.id}
                onChange={handleCompanyChange}
              >
                {companies.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option disabled>──────────</option>
                <option value="CREATE_NEW">+ Create new company</option>
                {companies.length > 1 && (
                  <option value="DELETE_CURRENT">✕ Delete this company</option>
                )}
              </select>
            </div>
          )}
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`
              }
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-200">
          <div className="text-xs text-gray-400">
            v1.0.0 &middot; Data stored locally
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto flex flex-col">
        {updateInfo.available && (
          <div className="bg-blue-50 p-4 border-b border-blue-100 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-blue-500 flex-shrink-0" />
            <div className="text-sm text-blue-700">
              <span className="font-semibold">Update Available!</span> Version {updateInfo.version} is now available. 
              Please download the latest version from <a href="https://github.com/eagleone34/LocalBookKeeping/releases/latest" target="_blank" rel="noopener noreferrer" className="font-medium underline hover:text-blue-800">GitHub</a>.
            </div>
          </div>
        )}
        <div className="p-8 max-w-7xl mx-auto w-full">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
