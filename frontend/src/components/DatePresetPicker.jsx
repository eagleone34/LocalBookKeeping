import { useState, useMemo } from 'react';
import { Calendar } from 'lucide-react';

/**
 * Compute date presets relative to the current date.
 * Returns { label, dateFrom (YYYY-MM-DD), dateTo (YYYY-MM-DD) }
 */
function getPresets() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-indexed

  const fmt = (d) => d.toISOString().slice(0, 10);
  const lastDay = (year, month) => new Date(year, month + 1, 0);

  const presets = [
    {
      key: 'this_month',
      label: 'This Month',
      dateFrom: fmt(new Date(y, m, 1)),
      dateTo: fmt(lastDay(y, m)),
    },
    {
      key: 'last_month',
      label: 'Last Month',
      dateFrom: fmt(new Date(y, m - 1, 1)),
      dateTo: fmt(lastDay(y, m - 1)),
    },
    {
      key: 'last_3_months',
      label: 'Last 3 Months',
      dateFrom: fmt(new Date(y, m - 2, 1)),
      dateTo: fmt(lastDay(y, m)),
    },
  ];

  // Add quarterly presets for the current year
  const quarters = [
    { key: `q1_${y}`, label: `Q1 ${y}`, startMonth: 0, endMonth: 2 },
    { key: `q2_${y}`, label: `Q2 ${y}`, startMonth: 3, endMonth: 5 },
    { key: `q3_${y}`, label: `Q3 ${y}`, startMonth: 6, endMonth: 8 },
    { key: `q4_${y}`, label: `Q4 ${y}`, startMonth: 9, endMonth: 11 },
  ];

  // Only show quarters up through the current one
  quarters.forEach(q => {
    if (q.startMonth <= m) {
      presets.push({
        key: q.key,
        label: q.label,
        dateFrom: fmt(new Date(y, q.startMonth, 1)),
        dateTo: fmt(lastDay(y, q.endMonth)),
      });
    }
  });

  // Year presets
  presets.push({
    key: 'ytd',
    label: `YTD ${y}`,
    dateFrom: fmt(new Date(y, 0, 1)),
    dateTo: fmt(now),
  });
  presets.push({
    key: `last_year`,
    label: `${y - 1}`,
    dateFrom: fmt(new Date(y - 1, 0, 1)),
    dateTo: fmt(new Date(y - 1, 11, 31)),
  });
  presets.push({
    key: 'all_time',
    label: 'All Time',
    dateFrom: '',
    dateTo: '',
  });

  return presets;
}

export default function DatePresetPicker({ dateFrom, dateTo, onDateChange }) {
  const [showCustom, setShowCustom] = useState(false);
  const presets = useMemo(() => getPresets(), []);

  // Determine which preset is active (if any)
  const activePreset = presets.find(p => p.dateFrom === dateFrom && p.dateTo === dateTo);

  const handlePreset = (preset) => {
    onDateChange(preset.dateFrom, preset.dateTo);
    setShowCustom(false);
  };

  // Format date range for display
  const formatDateRange = () => {
    if (!dateFrom && !dateTo) return 'All Time';
    if (!dateFrom) return `Up to ${new Date(dateTo + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    if (!dateTo) return `From ${new Date(dateFrom + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    
    const fromDate = new Date(dateFrom + 'T12:00:00');
    const toDate = new Date(dateTo + 'T12:00:00');
    const options = { month: 'short', day: 'numeric', year: 'numeric' };
    return `${fromDate.toLocaleDateString('en-US', options)} – ${toDate.toLocaleDateString('en-US', options)}`;
  };

  return (
    <div className="space-y-2">
      {/* Period row: label, preset buttons, showing indicator */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mr-1">Period</span>

        {/* Preset buttons */}
        {presets.map(p => (
          <button
            key={p.key}
            onClick={() => handlePreset(p)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150 ${
              activePreset?.key === p.key
                ? 'bg-primary-600 text-white shadow-sm'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setShowCustom(!showCustom)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150 flex items-center gap-1 ${
            showCustom || (!activePreset && (dateFrom || dateTo))
              ? 'bg-primary-600 text-white shadow-sm'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-800 dark:hover:text-gray-200'
          }`}
        >
          <Calendar className="w-3 h-3" />
          Custom
        </button>

        {/* Subtle date range indicator */}
        <span className="ml-auto text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {formatDateRange()}
        </span>
      </div>

      {/* Custom date inputs - slide open */}
      {showCustom && (
        <div className="flex items-center gap-2 pl-[3.5rem]">
          <input
            type="date"
            value={dateFrom}
            onChange={e => onDateChange(e.target.value, dateTo)}
            className="input-field text-xs py-1.5 px-2 w-36"
          />
          <span className="text-gray-400 dark:text-gray-500 text-xs">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => onDateChange(dateFrom, e.target.value)}
            className="input-field text-xs py-1.5 px-2 w-36"
          />
        </div>
      )}
    </div>
  );
}
