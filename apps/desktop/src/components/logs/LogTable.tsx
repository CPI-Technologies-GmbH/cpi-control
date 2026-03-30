import { useState, useRef, useCallback, useEffect } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ArrowDownToLine,
} from 'lucide-react';
import clsx from 'clsx';
import type { LogEntry, LogSource, LogLevel, Service } from '@/types';
import type { LogColumn } from './ColumnSelector';
import { getServiceColor } from './ServiceMultiSelect';

// ─── Constants ──────────────────────────────────────────────────────────────

const SOURCE_COLORS: Record<LogSource, string> = {
  kubernetes: 'bg-blue-500/20 text-blue-400',
  vercel: 'bg-gray-500/20 text-gray-300',
  github: 'bg-gray-500/20 text-gray-400',
  agent: 'bg-purple-500/20 text-purple-400',
  backend: 'bg-emerald-500/20 text-emerald-400',
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  error: 'text-red-400',
  warn: 'text-amber-400',
  info: 'text-gray-300',
  debug: 'text-gray-600',
};

const LEVEL_BADGE_COLORS: Record<LogLevel, string> = {
  error: 'bg-red-500/20 text-red-400',
  warn: 'bg-amber-500/20 text-amber-400',
  info: 'bg-gray-500/20 text-gray-400',
  debug: 'bg-gray-700/40 text-gray-600',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatLogTime(iso: string): string {
  try {
    const d = new Date(iso);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
  } catch {
    return iso;
  }
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface LogTableProps {
  entries: LogEntry[];
  visibleColumns: LogColumn[];
  services: Service[];
  allServiceIds: string[];
  isLoading: boolean;
  liveTail: boolean;
  autoScroll: boolean;
  onAutoScrollChange: (val: boolean) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function LogTable({
  entries,
  visibleColumns,
  services,
  allServiceIds,
  isLoading,
  liveTail,
  autoScroll,
  onAutoScrollChange,
}: LogTableProps) {
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(autoScroll);
  autoScrollRef.current = autoScroll;

  const serviceNameMap = new Map<string, string>();
  services.forEach((s) => serviceNameMap.set(s.id, s.name));

  // Auto-scroll
  useEffect(() => {
    if (autoScrollRef.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [entries]);

  const handleScroll = useCallback(() => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    onAutoScrollChange(atBottom);
  }, [onAutoScrollChange]);

  const resumeAutoScroll = useCallback(() => {
    onAutoScrollChange(true);
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [onAutoScrollChange]);

  // Loading skeleton
  if (isLoading && entries.length === 0) {
    return (
      <div className="card p-4 flex-shrink-0">
        <div className="space-y-1.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="skeleton w-16 h-3 rounded" />
              <div className="skeleton w-16 h-3 rounded" />
              <div className="skeleton w-10 h-3 rounded" />
              <div className="skeleton flex-1 h-3 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      onScroll={handleScroll}
      className="card flex-1 overflow-y-auto min-h-0 relative"
    >
      {/* Empty state */}
      {entries.length === 0 && !isLoading && (
        <div className="p-12 text-center">
          <div className="text-gray-600 text-3xl mb-3">&#9776;</div>
          <p className="text-gray-400">No log entries found</p>
          <p className="text-sm text-gray-600 mt-1">
            Adjust your filters or enable live tail
          </p>
        </div>
      )}

      {/* Table header */}
      {entries.length > 0 && (
        <>
          <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur-sm border-b border-gray-800 flex items-center gap-3 px-3 py-1.5 text-[10px] font-medium text-gray-500 uppercase tracking-wider">
            {/* Expand chevron space */}
            <span className="w-3 flex-shrink-0" />

            {visibleColumns.includes('timestamp') && (
              <span className="w-[90px] flex-shrink-0">Time</span>
            )}
            {visibleColumns.includes('service') && (
              <span className="w-[100px] flex-shrink-0">Service</span>
            )}
            {visibleColumns.includes('source') && (
              <span className="w-[72px] flex-shrink-0">Source</span>
            )}
            {visibleColumns.includes('level') && (
              <span className="w-[40px] flex-shrink-0">Level</span>
            )}
            {visibleColumns.includes('namespace') && (
              <span className="w-[100px] flex-shrink-0">Namespace</span>
            )}
            {visibleColumns.includes('pod') && (
              <span className="w-[140px] flex-shrink-0">Pod</span>
            )}
            {visibleColumns.includes('container') && (
              <span className="w-[100px] flex-shrink-0">Container</span>
            )}
            {visibleColumns.includes('message') && (
              <span className="flex-1 min-w-0">Message</span>
            )}
            {visibleColumns.includes('raw') && (
              <span className="flex-1 min-w-0">Raw JSON</span>
            )}
          </div>

          {/* Rows */}
          <div className="divide-y divide-gray-800/50">
            {entries.map((entry, idx) => (
              <LogRow
                key={entry.id}
                entry={entry}
                previousEntry={idx > 0 ? entries[idx - 1] : undefined}
                expanded={expandedEntry === entry.id}
                onToggle={() =>
                  setExpandedEntry((prev) => (prev === entry.id ? null : entry.id))
                }
                visibleColumns={visibleColumns}
                allServiceIds={allServiceIds}
                serviceNameMap={serviceNameMap}
              />
            ))}
          </div>
        </>
      )}

      {/* Resume auto-scroll button */}
      {liveTail && !autoScroll && (
        <button
          onClick={resumeAutoScroll}
          className="sticky bottom-3 left-1/2 -translate-x-1/2 mx-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-600 text-white text-xs font-medium shadow-lg hover:bg-blue-500 transition-colors z-10"
        >
          <ArrowDownToLine size={12} />
          Resume
        </button>
      )}
    </div>
  );
}

// ─── Log Row Sub-component ──────────────────────────────────────────────────

function LogRow({
  entry,
  previousEntry,
  expanded,
  onToggle,
  visibleColumns,
  allServiceIds,
  serviceNameMap,
}: {
  entry: LogEntry;
  previousEntry?: LogEntry;
  expanded: boolean;
  onToggle: () => void;
  visibleColumns: LogColumn[];
  allServiceIds: string[];
  serviceNameMap: Map<string, string>;
}) {
  const hasMetadata = entry.metadata && Object.keys(entry.metadata).length > 0;
  const serviceId = (entry.metadata?.serviceId as string) || '';
  const serviceName = serviceId
    ? serviceNameMap.get(serviceId) || serviceId
    : (entry.metadata?.pod as string)?.split('-').slice(0, -2).join('-') || '';

  const serviceColor = serviceId
    ? getServiceColor(serviceId, allServiceIds)
    : null;

  // Dedup: hide repeated tags when consecutive entries have same service + source + level
  const prevServiceId = (previousEntry?.metadata?.serviceId as string) || '';
  const isSameGroup = previousEntry
    && prevServiceId === serviceId
    && previousEntry.source === entry.source
    && previousEntry.level === entry.level;

  return (
    <div
      className={clsx(
        'px-3 py-1.5 hover:bg-gray-800/50 transition-colors cursor-pointer',
        expanded && 'bg-gray-800/30'
      )}
      onClick={onToggle}
    >
      <div className="flex items-start gap-3 text-xs">
        {/* Expand chevron */}
        <span className="flex-shrink-0 mt-0.5 text-gray-600 w-3">
          {hasMetadata &&
            (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
        </span>

        {/* Timestamp */}
        {visibleColumns.includes('timestamp') && (
          <span className="flex-shrink-0 text-gray-500 font-mono w-[90px]">
            {formatLogTime(entry.timestamp)}
          </span>
        )}

        {/* Service */}
        {visibleColumns.includes('service') && (
          isSameGroup ? (
            <span className="flex-shrink-0 w-[100px]" />
          ) : (
            <span
              className={clsx(
                'flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium w-[100px] truncate text-center',
                serviceColor
                  ? `${serviceColor.bg} ${serviceColor.text}`
                  : 'bg-gray-700/40 text-gray-500'
              )}
              title={serviceName}
            >
              {serviceName || '-'}
            </span>
          )
        )}

        {/* Source badge */}
        {visibleColumns.includes('source') && (
          isSameGroup ? (
            <span className="flex-shrink-0 w-[72px]" />
          ) : (
            <span
              className={clsx(
                'flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium w-[72px] text-center',
                SOURCE_COLORS[entry.source]
              )}
            >
              {entry.source}
            </span>
          )
        )}

        {/* Level badge */}
        {visibleColumns.includes('level') && (
          isSameGroup ? (
            <span className="flex-shrink-0 w-[40px]" />
          ) : (
            <span
              className={clsx(
                'flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium w-[40px] text-center uppercase',
                LEVEL_BADGE_COLORS[entry.level]
              )}
            >
              {entry.level}
            </span>
          )
        )}

        {/* Namespace */}
        {visibleColumns.includes('namespace') && (
          <span className="flex-shrink-0 text-gray-500 font-mono text-[10px] w-[100px] truncate">
            {(entry.metadata?.namespace as string) || '-'}
          </span>
        )}

        {/* Pod */}
        {visibleColumns.includes('pod') && (
          <span className="flex-shrink-0 text-gray-500 font-mono text-[10px] w-[140px] truncate" title={(entry.metadata?.pod as string) || ''}>
            {(entry.metadata?.pod as string) || '-'}
          </span>
        )}

        {/* Container */}
        {visibleColumns.includes('container') && (
          <span className="flex-shrink-0 text-gray-500 font-mono text-[10px] w-[100px] truncate">
            {(entry.metadata?.container as string) || '-'}
          </span>
        )}

        {/* Message */}
        {visibleColumns.includes('message') && (
          <span
            className={clsx(
              'font-mono break-all min-w-0',
              LEVEL_COLORS[entry.level]
            )}
          >
            {entry.message}
          </span>
        )}

        {/* Raw JSON */}
        {visibleColumns.includes('raw') && (
          <span className="font-mono text-gray-500 break-all min-w-0 text-[10px]">
            {JSON.stringify(entry)}
          </span>
        )}
      </div>

      {/* Expanded metadata */}
      {expanded && hasMetadata && (
        <div className="ml-6 mt-2 mb-1 p-2 rounded bg-gray-900/80 border border-gray-800">
          <table className="text-[11px] font-mono">
            <tbody>
              {Object.entries(entry.metadata!).map(([key, value]) => (
                <tr key={key}>
                  <td className="text-gray-500 pr-4 py-0.5 align-top whitespace-nowrap">
                    {key}
                  </td>
                  <td className="text-gray-300 py-0.5">
                    {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
