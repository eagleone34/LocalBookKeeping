import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard, BookOpen, ArrowLeftRight, PiggyBank,
  BarChart3, FileText, Settings, Inbox, Building2, AlertCircle,
  Eye, EyeOff, RotateCcw, Clock, Sun, Moon,
} from 'lucide-react';
import { useCompany } from '../context/CompanyContext';
import { useTheme } from '../context/ThemeContext';
import { useState, useEffect } from 'react';
import { getBackupPreviewStatus, exitBackupPreview, restoreBackup, triggerUpdate } from '../api/client';


const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/accounts', icon: BookOpen, label: 'Accounts' },
  { to: '/transactions', icon: ArrowLeftRight, label: 'Transactions' },
  { to: '/budgets', icon: PiggyBank, label: 'Budgets' },
  { to: '/reports', icon: BarChart3, label: 'Reports' },
  { to: '/inbox', icon: Inbox, label: 'Statements' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

function formatBackupDate(isoString) {
  if (!isoString) return '';
  try {
    return new Date(isoString).toLocaleString('en-CA', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

export default function Layout() {
  const { companies, currentCompany, switchCompany, createCompany, deleteCompany, loading } = useCompany();
  const { theme, toggleTheme } = useTheme();
  const [updateInfo, setUpdateInfo] = useState({ available: false, version: null });
  const [updateLoading, setUpdateLoading] = useState(false);
  const [updateError, setUpdateError] = useState(null);
  const [updateDone, setUpdateDone] = useState(false);

  // Preview mode state
  const [previewStatus, setPreviewStatus] = useState({ preview_active: false, filename: null, created_at: null });
  const [previewLoading, setPreviewLoading] = useState(false);
  const [restoreConfirm, setRestoreConfirm] = useState(false);

  useEffect(() => {
    fetch('/api/health/update')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.update_available) {
          setUpdateInfo({ available: true, version: data.latest_version });
        }
      })
      .catch(() => {});
  }, []);

  // Heartbeat: keeps the backend alive while the browser tab is open.
  useEffect(() => {
    const beat = () => fetch('/api/heartbeat').catch(() => {});
    beat();
    const id = setInterval(beat, 15000);
    return () => clearInterval(id);
  }, []);

  // Poll preview status every 3 seconds so the banner stays in sync
  useEffect(() => {
    const check = () => {
      getBackupPreviewStatus()
        .then(s => setPreviewStatus(s))
        .catch(() => {});
    };
    check();
    const id = setInterval(check, 3000);
    return () => clearInterval(id);
  }, []);

  const handleInstallUpdate = async () => {
    setUpdateLoading(true);
    setUpdateError(null);
    try {
      await triggerUpdate();
      setUpdateDone(true);
    } catch (err) {
      setUpdateError('Update failed: ' + err.message);
      setUpdateLoading(false);
    }
  };

  const handleExitPreview = async () => {
    setPreviewLoading(true);
    try {
      await exitBackupPreview();
      setPreviewStatus({ preview_active: false, filename: null, created_at: null });
      setRestoreConfirm(false);
      // Reload so all cached data refreshes
      window.location.reload();
    } catch (err) {
      alert('Failed to exit preview: ' + err.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleRestoreFromPreview = async () => {
    if (!previewStatus.filename) return;
    setPreviewLoading(true);
    try {
      await restoreBackup(previewStatus.filename);
      setRestoreConfirm(false);
      window.location.reload();
    } catch (err) {
      alert('Restore failed: ' + err.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleCompanyChange = async (e) => {
    const val = e.target.value;
    if (val === 'CREATE_NEW') {
      const name = window.prompt("Enter new company name:");
      if (name && name.trim()) {
        try {
          await createCompany(name.trim());
        } catch {
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
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <aside className="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h1 className="text-xl font-bold text-primary-700 dark:text-primary-400 flex items-center gap-2 mb-4 px-2">
            <BookOpen className="w-6 h-6" />
            LocalBooks
          </h1>

          {!loading && companies.length > 0 && currentCompany && (
            <div className="relative dropdown-container">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Building2 className="h-4 w-4 text-gray-500 dark:text-gray-400" />
              </div>
              <select
                className={`w-full bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 text-sm rounded-lg focus:ring-primary-500 focus:border-primary-500 block p-2.5 pl-9 font-medium ${previewStatus.preview_active ? 'opacity-50 cursor-not-allowed' : ''}`}
                value={currentCompany.id}
                onChange={handleCompanyChange}
                disabled={previewStatus.preview_active}
                title={previewStatus.preview_active ? 'Exit preview mode to switch companies' : undefined}
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
                    ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100'
                }`
              }
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div className="text-xs text-gray-400 dark:text-gray-500">
            v1.0.0 &middot; Data stored locally
          </div>
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto flex flex-col">
        {/* ── Preview Mode Banner ── */}
        {previewStatus.preview_active && (
          <div className="bg-amber-500 text-white px-4 py-3 flex items-center gap-3 shadow-md z-40 flex-shrink-0">
            <Eye className="w-5 h-5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-semibold">Preview Mode</span>
              <span className="ml-2 text-amber-100 text-sm">
                Viewing backup from{' '}
                <span className="font-medium text-white">
                  {formatBackupDate(previewStatus.created_at)}
                </span>
                {' '}— changes are read-only and will not affect your live data.
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {restoreConfirm ? (
                <div className="flex items-center gap-2 bg-amber-600 rounded-lg px-3 py-1.5">
                  <span className="text-sm font-medium">Restore this backup?</span>
                  <button
                    onClick={handleRestoreFromPreview}
                    disabled={previewLoading}
                    className="px-2 py-1 bg-white text-amber-700 rounded text-xs font-bold hover:bg-amber-50 transition-colors"
                  >
                    {previewLoading ? '…' : 'Yes, Restore'}
                  </button>
                  <button
                    onClick={() => setRestoreConfirm(false)}
                    className="px-2 py-1 bg-amber-400 text-white rounded text-xs font-medium hover:bg-amber-300 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => setRestoreConfirm(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-amber-700 rounded-lg text-sm font-semibold hover:bg-amber-50 transition-colors"
                    title="Make this backup the live database"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Restore This Backup
                  </button>
                  <button
                    onClick={handleExitPreview}
                    disabled={previewLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-sm font-semibold hover:bg-amber-700 transition-colors"
                    title="Return to your live data"
                  >
                    <EyeOff className="w-4 h-4" />
                    {previewLoading ? 'Exiting…' : 'Exit Preview'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Update Banner ── */}
        {updateInfo.available && (
          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 border-b border-blue-100 dark:border-blue-800 flex items-center gap-3 flex-shrink-0">
            <AlertCircle className="w-5 h-5 text-blue-500 flex-shrink-0" />
            <div className="flex-1 text-sm text-blue-700 dark:text-blue-300">
              {updateDone ? (
                <span className="font-semibold">
                  Installer is running — the app will restart shortly.
                </span>
              ) : (
                <>
                  <span className="font-semibold">Version {updateInfo.version} available.</span>
                  {' '}Your company data will be preserved.{' '}
                  {updateError && (
                    <span className="text-red-600 dark:text-red-400 mr-2">{updateError}</span>
                  )}
                </>
              )}
            </div>
            {!updateDone && (
              <button
                onClick={handleInstallUpdate}
                disabled={updateLoading}
                className="flex-shrink-0 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-semibold transition-colors"
              >
                {updateLoading ? 'Downloading…' : 'Update Now'}
              </button>
            )}
          </div>
        )}

        <div className="p-8 max-w-7xl mx-auto w-full">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
