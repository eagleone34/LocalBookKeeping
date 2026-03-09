/**
 * A reusable <select> that groups accounts by type: Expense, Income, Asset, Liability.
 * Usage: <GroupedAccountSelect accounts={[...]} value={id} onChange={fn} />
 */

const TYPE_ORDER = ['expense', 'income', 'asset', 'liability'];
const TYPE_LABELS = { expense: 'Expense', income: 'Income', asset: 'Asset', liability: 'Liability' };

export default function GroupedAccountSelect({
  accounts = [],
  value = '',
  onChange,
  placeholder = 'Select account...',
  required = false,
  className = 'input-field',
  showCode = true,
  includeEmpty = true,
}) {
  // Group active accounts by type
  const grouped = TYPE_ORDER.map(type => ({
    type,
    label: TYPE_LABELS[type],
    items: accounts.filter(a => a.type === type && a.is_active !== false),
  })).filter(g => g.items.length > 0);

  return (
    <select
      value={value}
      onChange={onChange}
      required={required}
      className={className}
    >
      {includeEmpty && <option value="">{placeholder}</option>}
      {grouped.map(({ type, label, items }) => (
        <optgroup key={type} label={`── ${label} ──`}>
          {items.map(a => (
            <option key={a.id} value={a.id}>
              {showCode && a.code ? `${a.code} – ` : ''}{a.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
