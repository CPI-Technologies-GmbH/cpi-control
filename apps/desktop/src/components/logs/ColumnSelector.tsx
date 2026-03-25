import { useState, useRef, useEffect } from 'react';
import { Columns3, Check } from 'lucide-react';
import clsx from 'clsx';

export type LogColumn =
  | 'timestamp'
  | 'service'
  | 'source'
  | 'level'
  | 'namespace'
  | 'pod'
  | 'container'
  | 'message'
  | 'raw';

export const ALL_COLUMNS: { id: LogColumn; label: string; defaultVisible: boolean }[] = [
  { id: 'timestamp', label: 'Timestamp', defaultVisible: true },
  { id: 'service', label: 'Service', defaultVisible: true },
  { id: 'source', label: 'Source', defaultVisible: true },
  { id: 'level', label: 'Level', defaultVisible: true },
  { id: 'namespace', label: 'Namespace', defaultVisible: false },
  { id: 'pod', label: 'Pod', defaultVisible: false },
  { id: 'container', label: 'Container', defaultVisible: false },
  { id: 'message', label: 'Message', defaultVisible: true },
  { id: 'raw', label: 'Raw JSON', defaultVisible: false },
];

export const DEFAULT_COLUMNS: LogColumn[] = ALL_COLUMNS
  .filter((c) => c.defaultVisible)
  .map((c) => c.id);

interface ColumnSelectorProps {
  visibleColumns: LogColumn[];
  onChange: (columns: LogColumn[]) => void;
}

export default function ColumnSelector({ visibleColumns, onChange }: ColumnSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function toggleColumn(col: LogColumn) {
    if (visibleColumns.includes(col)) {
      // Don't allow removing the last column
      if (visibleColumns.length <= 1) return;
      onChange(visibleColumns.filter((c) => c !== col));
    } else {
      // Insert at the correct position according to ALL_COLUMNS order
      const ordered = ALL_COLUMNS
        .map((c) => c.id)
        .filter((c) => visibleColumns.includes(c) || c === col);
      onChange(ordered);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={clsx(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border',
          open
            ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
            : 'btn-secondary'
        )}
        title="Column visibility"
      >
        <Columns3 size={14} />
        Columns
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-48 bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
          <div className="p-1.5">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide px-2 py-1">
              Visible Columns
            </p>
            {ALL_COLUMNS.map((col) => {
              const isVisible = visibleColumns.includes(col.id);
              return (
                <button
                  key={col.id}
                  onClick={() => toggleColumn(col.id)}
                  className={clsx(
                    'flex items-center gap-2 w-full px-2 py-1.5 rounded text-xs transition-colors',
                    isVisible
                      ? 'text-gray-200 hover:bg-gray-800'
                      : 'text-gray-500 hover:bg-gray-800 hover:text-gray-400'
                  )}
                >
                  <span
                    className={clsx(
                      'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0',
                      isVisible
                        ? 'bg-blue-500/30 border-blue-500/50'
                        : 'border-gray-700'
                    )}
                  >
                    {isVisible && <Check size={10} />}
                  </span>
                  {col.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
