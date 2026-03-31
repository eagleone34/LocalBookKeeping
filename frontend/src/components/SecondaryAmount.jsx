import { useCurrency } from '../hooks/useCurrency';

/**
 * Renders a secondary currency amount in brackets next to a primary amount.
 * Only renders when `show` is true AND the accountCurrency differs from the global currency.
 *
 * Example output: <span>(US$1,234.56)</span>
 */
export default function SecondaryAmount({ amount, accountCurrency, show }) {
  const { formatSecondary } = useCurrency();

  if (!show) return null;

  const secondary = formatSecondary(amount, accountCurrency);
  if (!secondary) return null;

  return (
    <span className="text-xs text-gray-400 dark:text-gray-500 ml-1 font-normal">
      ({secondary})
    </span>
  );
}
