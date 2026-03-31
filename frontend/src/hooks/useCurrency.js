import { useMemo } from 'react';
import { useCompany } from '../context/CompanyContext';

/**
 * Returns currency formatting utilities driven by the company's global currency
 * and stored conversion rate.
 *
 * Usage:
 *   const { formatMoney, formatPrimary, formatSecondary, globalCurrency } = useCurrency();
 *
 *   // Simple — when no per-account currency is known:
 *   formatMoney(1234.56)  →  "$1,234.56" (in global currency)
 *
 *   // With account currency (may convert + show secondary):
 *   formatPrimary(1234.56, 'USD')   →  "$1,704.69 CAD"  (if global is CAD)
 *   formatSecondary(1234.56, 'USD') →  "($1,234.56 USD)" or null if same currency
 */
export function useCurrency() {
  const { currentCompany } = useCompany();

  const globalCurrency = currentCompany?.currency || 'USD';

  const usdCadRate = useMemo(() => {
    if (!currentCompany?.conversion_rates) return 1;
    try {
      const rates = JSON.parse(currentCompany.conversion_rates);
      return rates.USD_CAD || 1;
    } catch {
      return 1;
    }
  }, [currentCompany?.conversion_rates]);

  function convertToGlobal(amount, fromCurrency) {
    if (!fromCurrency || fromCurrency === globalCurrency || usdCadRate === 1) return amount;
    if (globalCurrency === 'CAD' && fromCurrency === 'USD') return amount * usdCadRate;
    if (globalCurrency === 'USD' && fromCurrency === 'CAD') return amount / usdCadRate;
    return amount;
  }

  /** Format amount in global currency, converting from accountCurrency if needed. */
  function formatPrimary(amount, accountCurrency, opts = {}) {
    const converted = convertToGlobal(amount, accountCurrency);
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: globalCurrency,
      minimumFractionDigits: opts.minimumFractionDigits ?? 2,
      maximumFractionDigits: opts.maximumFractionDigits ?? 2,
    }).format(converted);
  }

  /**
   * Returns the secondary (original) currency string if the account currency
   * differs from the global currency, otherwise null.
   */
  function formatSecondary(amount, accountCurrency) {
    if (!accountCurrency || accountCurrency === globalCurrency) return null;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: accountCurrency,
    }).format(amount);
  }

  /**
   * Drop-in replacement for the old hardcoded formatMoney(val).
   * When no account currency is known, just formats in global currency.
   */
  function formatMoney(val, opts = {}) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: globalCurrency,
      minimumFractionDigits: opts.minimumFractionDigits ?? 0,
      maximumFractionDigits: opts.maximumFractionDigits ?? 0,
    }).format(val);
  }

  return { formatMoney, formatPrimary, formatSecondary, globalCurrency, usdCadRate, convertToGlobal };
}

/**
 * Helper to check if a list of accounts contains more than one currency.
 * Used to decide whether to show the secondary-currency toggle on a page.
 */
export function getHasMultiCurrency(accounts = []) {
  const currencies = new Set(accounts.map(a => a.currency || 'USD'));
  return currencies.size > 1;
}
