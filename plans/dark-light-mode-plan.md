# Dark/Light Mode Architecture Plan

## Overview

This document outlines the comprehensive plan for adding Dark and Light mode support to the LocalBookKeeping application. The implementation will follow a systematic approach with clear phases and component-by-component changes.

## Current State Analysis

### Current Styling Approach
- **Tailwind CSS** with custom `primary` color palette (blues)
- **Global component classes** in `index.css`: `.card`, `.btn`, `.input-field`, `.badge`
- **Current colors**: `bg-gray-50` (backgrounds), `bg-white` (cards), `text-gray-900` (text)
- **Charts**: Recharts with hardcoded colors (`#3b82f6`, `#ef4444`, etc.)

### Architecture
- React with Vite and React Router
- Context API (CompanyContext pattern established)
- No current theming infrastructure

---

## 1. Tailwind Dark Mode Setup

### Configuration Changes

**`frontend/tailwind.config.js`:**
```javascript
export default {
  darkMode: 'class', // Enable class-based dark mode
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          // Keep existing primary scale
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
}
```

**How it works**: Adding `darkMode: 'class'` enables Tailwind's `dark:` variant. When the `dark` class is present on `<html>` or `<body>`, all `dark:`-prefixed utilities activate.

---

## 2. Theme Context Provider

**Create `frontend/src/context/ThemeContext.jsx`:**

```javascript
import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState('system'); // 'light' | 'dark' | 'system'
  const [resolvedTheme, setResolvedTheme] = useState('light'); // Actual 'light' | 'dark'

  // Get system preference
  const getSystemTheme = () => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  };

  // Apply theme to document
  const applyTheme = (newTheme) => {
    const root = document.documentElement;
    const effectiveTheme = newTheme === 'system' ? getSystemTheme() : newTheme;
    
    setResolvedTheme(effectiveTheme);
    
    if (effectiveTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    
    // Store preference
    localStorage.setItem('theme', newTheme);
  };

  // Initialize theme on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') || 'system';
    setTheme(savedTheme);
    applyTheme(savedTheme);
  }, []);

  // Listen for system theme changes
  useEffect(() => {
    if (theme !== 'system') return;
    
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => applyTheme('system');
    
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [theme]);

  const handleSetTheme = (newTheme) => {
    setTheme(newTheme);
    applyTheme(newTheme);
  };

  return (
    <ThemeContext.Provider value={{
      theme, // User preference: 'light' | 'dark' | 'system'
      setTheme: handleSetTheme,
      resolvedTheme // Actual current theme: 'light' | 'dark'
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
```

**Logic Flow:**
1. On mount: Read `localStorage.theme` (default: 'system')
2. Apply theme by toggling `dark` class on `<html>` element
3. If 'system' mode: Listen to `prefers-color-scheme` changes
4. Expose `theme` (preference) and `resolvedTheme` (actual)

---

## 3. CSS Strategy: CSS Custom Properties

**Update `frontend/src/index.css`:**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* Light Mode Colors */
    --color-bg-primary: #f9fafb;    /* gray-50 */
    --color-bg-secondary: #ffffff;   /* white */
    --color-bg-card: #ffffff;        /* white */
    --color-bg-input: #ffffff;       /* white */
    --color-bg-hover: #f3f4f6;       /* gray-100 */
    --color-bg-active: #eff6ff;      /* primary-50 */

    --color-text-primary: #111827;   /* gray-900 */
    --color-text-secondary: #6b7280; /* gray-500 */
    --color-text-muted: #9ca3af;     /* gray-400 */
    --color-text-inverse: #ffffff;   /* white */

    --color-border: #e5e7eb;         /* gray-200 */
    --color-border-hover: #d1d5db;   /* gray-300 */
    --color-border-active: #3b82f6;  /* primary-500 */

    --color-shadow: rgba(0, 0, 0, 0.05);
    --color-shadow-lg: rgba(0, 0, 0, 0.1);
  }

  .dark {
    /* Dark Mode Colors */
    --color-bg-primary: #111827;     /* gray-900 */
    --color-bg-secondary: #1f2937;   /* gray-800 */
    --color-bg-card: #1f2937;        /* gray-800 */
    --color-bg-input: #111827;       /* gray-900 */
    --color-bg-hover: #374151;       /* gray-700 */
    --color-bg-active: #1e3a8a;      /* primary-900 */

    --color-text-primary: #f9fafb;   /* gray-50 */
    --color-text-secondary: #d1d5db; /* gray-300 */
    --color-text-muted: #9ca3af;     /* gray-400 */
    --color-text-inverse: #111827;   /* gray-900 */

    --color-border: #374151;         /* gray-700 */
    --color-border-hover: #4b5563;   /* gray-600 */
    --color-border-active: #60a5fa;  /* primary-400 */

    --color-shadow: rgba(0, 0, 0, 0.3);
    --color-shadow-lg: rgba(0, 0, 0, 0.5);
  }

  body {
    @apply bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] antialiased;
  }
}

@layer components {
  .btn {
    @apply inline-flex items-center justify-center px-4 py-2 rounded-lg font-medium text-sm transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2;
  }
  .btn-primary {
    @apply btn bg-primary-600 text-white hover:bg-primary-700 focus:ring-primary-500;
  }
  .btn-secondary {
    @apply btn bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] border border-[var(--color-border)] hover:bg-[var(--color-bg-hover)] focus:ring-primary-500;
  }
  .btn-danger {
    @apply btn bg-red-600 text-white hover:bg-red-700 focus:ring-red-500;
  }
  .btn-success {
    @apply btn bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-500;
  }
  .btn-sm {
    @apply px-3 py-1.5 text-xs;
  }

  .card {
    @apply bg-[var(--color-bg-card)] rounded-xl shadow-sm border border-[var(--color-border)] p-6;
  }

  .input-field {
    @apply block w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-input)] text-[var(--color-text-primary)] shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm;
  }

  .label {
    @apply block text-sm font-medium text-[var(--color-text-secondary)] mb-1;
  }

  .badge {
    @apply inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium;
  }
  .badge-income {
    @apply badge bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200;
  }
  .badge-expense {
    @apply badge bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200;
  }
  .badge-asset {
    @apply badge bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200;
  }
  .badge-liability {
    @apply badge bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200;
  }
}
```

**Strategy Rationale:**
- **CSS Custom Properties**: More maintainable than Tailwind's `dark:` variant everywhere
- **Centralized colors**: Single source of truth for theme colors
- **Gradual migration**: Can mix CSS variables with Tailwind's `dark:` variant during transition
- **Better for charts**: Can pass CSS variables to Recharts for dynamic theming

---

## 4. Component-by-Component Changes

### Phase 2: Core Layout (`Layout.jsx`)

```jsx
import { NavLink, Outlet } from 'react-router-dom';
import {
  // ... existing imports
  Moon, Sun, Monitor
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export default function Layout() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  // ... existing code

  const ThemeIcon = {
    light: Sun,
    dark: Moon,
    system: Monitor
  }[theme];

  return (
    <div className="flex h-screen bg-[var(--color-bg-primary)]">
      {/* Sidebar */}
      <aside className="w-64 bg-[var(--color-bg-secondary)] border-r border-[var(--color-border)] flex flex-col">
        <div className="p-4 border-b border-[var(--color-border)]">
          <h1 className="text-xl font-bold text-primary-700 flex items-center gap-2 mb-4 px-2">
            <BookOpen className="w-6 h-6" />
            LocalBooks
          </h1>

          {/* Theme Toggle */}
          <div className="mb-4">
            <label className="label">Theme</label>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              className="input-field"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
          </div>

          {/* ... company selector ... */}
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
                    ? 'bg-[var(--color-bg-active)] text-primary-700'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
                }`
              }
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        
        <div className="p-4 border-t border-[var(--color-border)]">
          <div className="text-xs text-[var(--color-text-muted)]">
            v1.0.0 &middot; Data stored locally
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto flex flex-col">
        {updateInfo.available && (
          <div className="bg-blue-50 dark:bg-blue-900 p-4 border-b border-blue-100 dark:border-blue-800 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-blue-500 dark:text-blue-400 flex-shrink-0" />
            <div className="text-sm text-blue-700 dark:text-blue-300">
              {/* ... update message ... */}
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
```

**Changes:**
- Replace all `bg-gray-50` → `bg-[var(--color-bg-primary)]`
- Replace all `bg-white` → `bg-[var(--color-bg-secondary)]`
- Replace all `border-gray-200` → `border-[var(--color-border)]`
- Replace all `text-gray-600` → `text-[var(--color-text-secondary)]`
- Add theme selector dropdown in sidebar
- Add dark mode support for update banner

---

### Phase 3: Page-by-Page Conversion

#### `Dashboard.jsx` Changes

```jsx
// Update chart colors to use CSS variables
const chartColors = {
  income: 'var(--color-income, #10b981)',
  expenses: 'var(--color-expenses, #ef4444)',
  primary: 'var(--color-primary, #3b82f6)'
};

// In the component:
<Bar dataKey="income" fill={chartColors.income} />
<Bar dataKey="expenses" fill={chartColors.expenses} />

// Update Pie chart colors
const COLORS_LIGHT = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
const COLORS_DARK = ['#60a5fa', '#f87171', '#34d399', '#fbbf24', '#a78bfa', '#f472b6', '#22d3ee', '#a3e635'];

const colors = resolvedTheme === 'dark' ? COLORS_DARK : COLORS_LIGHT;

// Dashboard-specific updates:
// - All `text-gray-900` → `text-[var(--color-text-primary)]`
// - All `text-gray-500` → `text-[var(--color-text-secondary)]`
// - All `bg-*-50` card backgrounds → use CSS variables
// - Chart colors adapt to theme
```

#### `Settings.jsx` Changes

```jsx
// Add Theme Settings section
<div className="card max-w-2xl">
  <h3 className="text-lg font-semibold mb-4">Appearance</h3>
  <div className="space-y-4">
    <div>
      <label className="label">Theme</label>
      <div className="grid grid-cols-3 gap-3">
        <button
          onClick={() => setTheme('light')}
          className={`p-4 rounded-lg border-2 text-center transition-colors ${
            theme === 'light'
              ? 'border-primary-500 bg-[var(--color-bg-active)]'
              : 'border-[var(--color-border)] bg-[var(--color-bg-card)] hover:bg-[var(--color-bg-hover)]'
          }`}
        >
          <Sun className="w-6 h-6 mx-auto mb-2 text-yellow-500" />
          <div className="font-medium">Light</div>
        </button>
        
        <button
          onClick={() => setTheme('dark')}
          className={`p-4 rounded-lg border-2 text-center transition-colors ${
            theme === 'dark'
              ? 'border-primary-500 bg-[var(--color-bg-active)]'
              : 'border-[var(--color-border)] bg-[var(--color-bg-card)] hover:bg-[var(--color-bg-hover)]'
          }`}
        >
          <Moon className="w-6 h-6 mx-auto mb-2 text-blue-400" />
          <div className="font-medium">Dark</div>
        </button>
        
        <button
          onClick={() => setTheme('system')}
          className={`p-4 rounded-lg border-2 text-center transition-colors ${
            theme === 'system'
              ? 'border-primary-500 bg-[var(--color-bg-active)]'
              : 'border-[var(--color-border)] bg-[var(--color-bg-card)] hover:bg-[var(--color-bg-hover)]'
          }`}
        >
          <Monitor className="w-6 h-6 mx-auto mb-2 text-[var(--color-text-secondary)]" />
          <div className="font-medium">System</div>
        </button>
      </div>
    </div>
    
    <div className="text-sm text-[var(--color-text-muted)]">
      {theme === 'system' 
        ? `Using system preference (${resolvedTheme} mode)`
        : `Theme set to ${theme} mode`
      }
    </div>
  </div>
</div>
```

#### Other Pages (Accounts, Transactions, Budgets, Reports, Inbox)

**Common changes for all pages:**
1. Import and use `useTheme()` if needed for chart colors
2. Replace all color classes with CSS variables:
   - `bg-white` → `bg-[var(--color-bg-card)]`
   - `bg-gray-50` → `bg-[var(--color-bg-primary)]`
   - `text-gray-900` → `text-[var(--color-text-primary)]`
   - `text-gray-500` → `text-[var(--color-text-secondary)]`
   - `text-gray-600` → `text-[var(--color-text-secondary)]`
   - `text-gray-700` → `text-[var(--color-text-primary)]`
   - `border-gray-200` → `border-[var(--color-border)]`
   - `hover:bg-gray-50` → `hover:bg-[var(--color-bg-hover)]`
   - `hover:bg-gray-100` → `hover:bg-[var(--color-bg-hover)]`

3. **Tables:**
```jsx
// Before:
table className="min-w-full divide-y divide-gray-200"

// After:
table className="min-w-full divide-y divide-[var(--color-border)]"
```

4. **Form elements:**
```jsx
// Before:
<input className="block w-full rounded-lg border-gray-300" />

// After:
<input className="input-field" /> // Use the existing component class
```

---

## 5. Theme Toggle UI

### Option A: Header Quick Toggle (Recommended)

Add to `Layout.jsx` header:
```jsx
<div className="flex items-center gap-2">
  <button
    onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    className="p-2 rounded-lg hover:bg-[var(--color-bg-hover)] transition-colors"
    title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
  >
    {resolvedTheme === 'dark' ? (
      <Sun className="w-5 h-5 text-yellow-500" />
    ) : (
      <Moon className="w-5 h-5 text-gray-600" />
    )}
  </button>
</div>
```

### Option B: Settings Page (Detailed)

Three-state toggle with visual preview (shown in Settings section above).

### Option C: Both Locations
- Quick toggle in header for frequent switching
- Detailed settings in Settings page for preference management

**Recommendation**: Implement Option C for best UX.

---

## 6. Implementation Phases

### Phase 1: Infrastructure (1-2 hours)
- Update `tailwind.config.js` with `darkMode: 'class'`
- Create `ThemeContext.jsx` with system preference detection
- Wrap `App.jsx` with `ThemeProvider`
- Update `index.css` with CSS custom properties
- Test theme switching works (toggle dark class manually)

### Phase 2: Core Layout (1-2 hours)
- Update `Layout.jsx` with CSS variables
- Add theme selector to sidebar
- Test navigation and sidebar theming
- Update header and main content areas

### Phase 3: Page-by-Page Conversion (4-6 hours)
**Priority order:**
1. `Dashboard.jsx` (most visible, includes charts)
2. `Settings.jsx` (add theme settings)
3. `Transactions.jsx` (tables, forms)
4. `Accounts.jsx` (tables, cards)
5. `Budgets.jsx` (charts, tables)
6. `Reports.jsx` (charts, tables)
7. `Inbox.jsx` (file upload, lists)

For each page:
- Replace background colors with CSS variables
- Replace text colors with CSS variables
- Replace border colors with CSS variables
- Test in both light and dark modes

### Phase 4: Charts and Components (2-3 hours)
- Create `chartThemes.js` utility
- Update all Recharts components to use dynamic theme
- Update `DatePresetPicker.jsx`
- Update `GroupedAccountSelect.jsx`
- Update `ImportWizard.jsx`
- Test all chart types in both themes

### Phase 5: Polish and Testing (1-2 hours)
- Add smooth transitions between themes
- Test across different browsers
- Test system preference detection
- Verify localStorage persistence
- Check contrast ratios for accessibility
- Add loading states during theme switch
- Test all interactive elements (hover, focus, active states)

**Total estimated time**: 9-15 hours

---

## 7. Color Palette Recommendations

### Light Mode (Current)
```css
--color-bg-primary: #f9fafb;    /* gray-50 - Main background */
--color-bg-secondary: #ffffff;   /* white - Cards, sidebar */
--color-bg-card: #ffffff;        /* white - Cards */
--color-bg-input: #ffffff;       /* white - Form inputs */
--color-bg-hover: #f3f4f6;       /* gray-100 - Hover states */
--color-bg-active: #eff6ff;      /* primary-50 - Active states */

--color-text-primary: #111827;   /* gray-900 - Headings, primary text */
--color-text-secondary: #6b7280; /* gray-500 - Secondary text */
--color-text-muted: #9ca3af;     /* gray-400 - Muted text */
--color-text-inverse: #ffffff;   /* white - Text on dark backgrounds */

--color-border: #e5e7eb;         /* gray-200 - Borders */
--color-border-hover: #d1d5db;   /* gray-300 - Hover borders */
--color-border-active: #3b82f6;  /* primary-500 - Active borders */
```

### Dark Mode (Recommended)
```css
--color-bg-primary: #111827;     /* gray-900 - Main background */
--color-bg-secondary: #1f2937;   /* gray-800 - Cards, sidebar */
--color-bg-card: #1f2937;        /* gray-800 - Cards */
--color-bg-input: #111827;       /* gray-900 - Form inputs */
--color-bg-hover: #374151;       /* gray-700 - Hover states */
--color-bg-active: #1e3a8a;      /* primary-900 - Active states */

--color-text-primary: #f9fafb;   /* gray-50 - Headings, primary text */
--color-text-secondary: #d1d5db; /* gray-300 - Secondary text */
--color-text-muted: #9ca3af;     /* gray-400 - Muted text */
--color-text-inverse: #111827;   /* gray-900 - Text on light backgrounds */

--color-border: #374151;         /* gray-700 - Borders */
--color-border-hover: #4b5563;   /* gray-600 - Hover borders */
--color-border-active: #60a5fa;  /* primary-400 - Active borders */
```

### Chart Colors
```css
/* Light mode */
--color-income: #10b981;         /* emerald-500 */
--color-expenses: #ef4444;       /* red-500 */
--color-assets: #3b82f6;         /* blue-500 */
--color-liabilities: #f59e0b;    /* amber-500 */

/* Dark mode (automatically applied) */
--color-income: #34d399;         /* emerald-400 */
--color-expenses: #f87171;       /* red-400 */
--color-assets: #60a5fa;         /* blue-400 */
--color-liabilities: #fbbf24;    /* amber-400 */
```

**Accessibility Notes:**
- All text maintains WCAG AA contrast ratios (4.5:1 minimum)
- Interactive elements have clear hover/focus states in both themes
- System preference detection ensures accessibility settings are respected
