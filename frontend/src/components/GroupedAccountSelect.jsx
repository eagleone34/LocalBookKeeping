/**
 * A reusable <select> that groups accounts by type: Expense, Income, Asset, Liability.
 * Usage: <GroupedAccountSelect accounts={[...]} value={id} onChange={fn} />
 *
 * Optional: pass `onAddNew` callback to show a "+ Add New Account" option at the top.
 * When selected, it fires onAddNew() instead of the normal onChange.
 */

const TYPE_ORDER = ['expense', 'income', 'asset', 'liability'];
const TYPE_LABELS = { expense: 'Expense', income: 'Income', asset: 'Asset', liability: 'Liability' };

const ADD_NEW_VALUE = '__ADD_NEW__';

export default function GroupedAccountSelect({
  accounts = [],
  value = '',
  onChange,
  onAddNew,
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

  const handleChange = (e) => {
    if (e.target.value === ADD_NEW_VALUE) {
      // Reset the select back to current value so it doesn't stick on "__ADD_NEW__"
      e.target.value = value || '';
      if (onAddNew) onAddNew();
      return;
    }
    if (onChange) onChange(e);
  };

  return (
    <select
      value={value}
      onChange={handleChange}
      required={required}
      className={className}
    >
      {includeEmpty && <option value="">{placeholder}</option>}
      {onAddNew && (
        <option value={ADD_NEW_VALUE}>+ Add New Account</option>
      )}
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
