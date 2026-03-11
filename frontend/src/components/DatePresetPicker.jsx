import { useState, useMemo } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';

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

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Preset buttons */}
      <div className="flex flex-wrap gap-1.5">
        {presets.map(p => (
          <button
            key={p.key}
            onClick={() => handlePreset(p)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 ${
              activePreset?.key === p.key
                ? 'bg-primary-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-800'
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setShowCustom(!showCustom)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 flex items-center gap-1 ${
            showCustom || (!activePreset && (dateFrom || dateTo))
              ? 'bg-primary-600 text-white shadow-sm'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-800'
          }`}
        >
          <Calendar className="w-3 h-3" />
          Custom
        </button>
      </div>

      {/* Custom date inputs - slide open */}
      {showCustom && (
        <div className="flex items-center gap-2 ml-1 animate-in">
          <input
            type="date"
            value={dateFrom}
            onChange={e => onDateChange(e.target.value, dateTo)}
            className="input-field text-xs py-1.5 px-2 w-36"
          />
          <span className="text-gray-400 text-xs">to</span>
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
