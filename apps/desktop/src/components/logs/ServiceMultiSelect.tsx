import { X, Check } from 'lucide-react';
import clsx from 'clsx';
import type { Service } from '@/types';

// 12 distinct colors for service chips — visually separate, readable on dark bg
const SERVICE_COLORS = [
  { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30', bar: '#3b82f6' },
  { bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/30', bar: '#10b981' },
  { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/30', bar: '#f59e0b' },
  { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30', bar: '#a855f7' },
  { bg: 'bg-rose-500/20', text: 'text-rose-400', border: 'border-rose-500/30', bar: '#f43f5e' },
  { bg: 'bg-cyan-500/20', text: 'text-cyan-400', border: 'border-cyan-500/30', bar: '#06b6d4' },
  { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30', bar: '#f97316' },
  { bg: 'bg-pink-500/20', text: 'text-pink-400', border: 'border-pink-500/30', bar: '#ec4899' },
  { bg: 'bg-lime-500/20', text: 'text-lime-400', border: 'border-lime-500/30', bar: '#84cc16' },
  { bg: 'bg-indigo-500/20', text: 'text-indigo-400', border: 'border-indigo-500/30', bar: '#6366f1' },
  { bg: 'bg-teal-500/20', text: 'text-teal-400', border: 'border-teal-500/30', bar: '#14b8a6' },
  { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30', bar: '#eab308' },
];

/** Get a stable color for a given service ID based on its index in the sorted list. */
export function getServiceColor(serviceId: string, allServiceIds: string[]) {
  const sorted = [...allServiceIds].sort();
  const index = sorted.indexOf(serviceId);
  if (index < 0) return SERVICE_COLORS[0];
  return SERVICE_COLORS[index % SERVICE_COLORS.length];
}

/** Get a stable bar color string for a given service ID. */
export function getServiceBarColor(serviceId: string, allServiceIds: string[]): string {
  return getServiceColor(serviceId, allServiceIds).bar;
}

interface ServiceMultiSelectProps {
  services: Service[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export default function ServiceMultiSelect({
  services,
  selectedIds,
  onChange,
}: ServiceMultiSelectProps) {
  const allIds = services.map((s) => s.id);

  function toggleService(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((sid) => sid !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  function selectAll() {
    onChange(allIds);
  }

  function clearAll() {
    onChange([]);
  }

  const isAllSelected = selectedIds.length === allIds.length && allIds.length > 0;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-gray-500 uppercase tracking-wide flex-shrink-0">Services</span>

      {/* Quick actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={selectAll}
          className={clsx(
            'px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors border',
            isAllSelected
              ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
              : 'bg-gray-800 text-gray-500 border-gray-700 hover:text-gray-400'
          )}
        >
          All
        </button>
        <button
          onClick={clearAll}
          className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-800 text-gray-500 border border-gray-700 hover:text-gray-400 transition-colors"
        >
          Clear
        </button>
      </div>

      {/* Service chips */}
      <div className="flex flex-wrap gap-1">
        {services.map((svc) => {
          const color = getServiceColor(svc.id, allIds);
          const selected = selectedIds.includes(svc.id);
          return (
            <button
              key={svc.id}
              onClick={() => toggleService(svc.id)}
              className={clsx(
                'flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors border',
                selected
                  ? `${color.bg} ${color.text} ${color.border}`
                  : 'bg-gray-800 text-gray-600 border-gray-700 hover:text-gray-400'
              )}
            >
              {selected && <Check size={10} className="flex-shrink-0" />}
              <span className="truncate max-w-[120px]">{svc.name}</span>
              {selected && (
                <X
                  size={10}
                  className="flex-shrink-0 opacity-60 hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(selectedIds.filter((sid) => sid !== svc.id));
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Summary when many selected */}
      {selectedIds.length === 0 && services.length > 0 && (
        <span className="text-[10px] text-gray-600 italic">All services (unfiltered)</span>
      )}
    </div>
  );
}
