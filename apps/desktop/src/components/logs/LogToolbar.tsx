import {
  Play,
  Pause,
  Search,
  ExternalLink,
} from 'lucide-react';
import clsx from 'clsx';
import type { LogSource, LogLevel, LogViewConfigData, Service } from '@/types';
import type { LogColumn } from './ColumnSelector';
import ColumnSelector from './ColumnSelector';
import LogConfigManager from './LogConfigManager';
// ─── Constants ──────────────────────────────────────────────────────────────
const ALL_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const TIME_RANGES = ['5m', '15m', '30m', '1h', '6h', '24h', '7d'] as const;

const SOURCE_COLORS: Record<LogSource, string> = {
  kubernetes: 'bg-blue-500/20 text-blue-400',
  vercel: 'bg-gray-500/20 text-gray-300',
  github: 'bg-gray-500/20 text-gray-400',
  agent: 'bg-purple-500/20 text-purple-400',
  backend: 'bg-emerald-500/20 text-emerald-400',
};

const LEVEL_BADGE_COLORS: Record<LogLevel, string> = {
  error: 'bg-red-500/20 text-red-400',
  warn: 'bg-amber-500/20 text-amber-400',
  info: 'bg-gray-500/20 text-gray-400',
  debug: 'bg-gray-700/40 text-gray-600',
};

// ─── Props ──────────────────────────────────────────────────────────────────

interface LogToolbarProps {
  // Services
  services: Service[];
  selectedServiceIds: string[];
  onSelectedServiceIdsChange: (ids: string[]) => void;

  // Source filter
  sources: LogSource[];
  onSourcesChange: (sources: LogSource[]) => void;

  // Level filter
  levels: LogLevel[];
  onLevelsChange: (levels: LogLevel[]) => void;

  // Time range
  since: string;
  onSinceChange: (since: string) => void;

  // Search
  search: string;
  onSearchChange: (search: string) => void;

  // Columns
  visibleColumns: LogColumn[];
  onColumnsChange: (cols: LogColumn[]) => void;

  // Live tail
  liveTail: boolean;
  onLiveTailToggle: () => void;

  // Entry count
  entryCount: number;

  // Embedded mode (ServiceDetail log tab) — hide service/source selectors & config manager
  isEmbedded?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function LogToolbar({
  services,
  selectedServiceIds,
  onSelectedServiceIdsChange,
  sources,
  onSourcesChange,
  levels,
  onLevelsChange,
  since,
  onSinceChange,
  search,
  onSearchChange,
  visibleColumns,
  onColumnsChange,
  liveTail,
  onLiveTailToggle,
  entryCount,
  isEmbedded = false,
}: LogToolbarProps) {
  function toggleSource(source: LogSource) {
    if (sources.includes(source)) {
      onSourcesChange(sources.filter((s) => s !== source));
    } else {
      onSourcesChange([...sources, source]);
    }
  }

  function toggleLevel(level: LogLevel) {
    if (levels.includes(level)) {
      onLevelsChange(levels.filter((l) => l !== level));
    } else {
      onLevelsChange([...levels, level]);
    }
  }

  function handleConfigLoad(config: LogViewConfigData) {
    if (config.selectedServiceIds) onSelectedServiceIdsChange(config.selectedServiceIds);
    if (config.sources) onSourcesChange(config.sources as LogSource[]);
    if (config.levels) onLevelsChange(config.levels as LogLevel[]);
    if (config.since) onSinceChange(config.since);
    if (config.search !== undefined) onSearchChange(config.search);
    if (config.columns) onColumnsChange(config.columns as LogColumn[]);
  }

  function handleOpenInWindow() {
    const params = new URLSearchParams();
    if (selectedServiceIds.length > 0) {
      selectedServiceIds.forEach((id) => params.append('serviceId', id));
    }
    sources.forEach((s) => params.append('source', s));
    levels.forEach((l) => params.append('level', l));
    if (since) params.set('since', since);
    if (search) params.set('search', search);
    visibleColumns.forEach((c) => params.append('col', c));

    const qs = params.toString();
    const url = `/logs/live${qs ? `?${qs}` : ''}`;
    window.open(url, '_blank', 'width=1200,height=800,menubar=no,toolbar=no');
  }

  return (
    <div className="space-y-3 flex-shrink-0">
      {/* Top bar: title + actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-100">Logs</h1>
          {entryCount > 0 && (
            <span className="text-sm text-gray-500">({entryCount})</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isEmbedded && (
            <LogConfigManager
              currentState={{
                selectedServiceIds,
                sources,
                levels,
                since,
                search,
                columns: visibleColumns,
              }}
              onLoad={handleConfigLoad}
            />
          )}
          {!isEmbedded && (
            <ColumnSelector
              visibleColumns={visibleColumns}
              onChange={onColumnsChange}
            />
          )}
          {!isEmbedded && (
            <button
              onClick={handleOpenInWindow}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors btn-secondary"
              title="Open in new window"
            >
              <ExternalLink size={14} />
              Window
            </button>
          )}
          <button
            onClick={onLiveTailToggle}
            className={clsx(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              liveTail
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'btn-secondary'
            )}
          >
            {liveTail ? <Pause size={14} /> : <Play size={14} />}
            {liveTail ? 'Pause' : 'Live Tail'}
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Level filters */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 uppercase tracking-wide">Level</span>
            <div className="flex gap-1.5">
              {ALL_LEVELS.map((l) => (
                <button
                  key={l}
                  onClick={() => toggleLevel(l)}
                  className={clsx(
                    'px-2 py-0.5 rounded text-xs font-medium transition-colors border',
                    levels.includes(l)
                      ? `${LEVEL_BADGE_COLORS[l]} border-current/20`
                      : 'bg-gray-800 text-gray-600 border-gray-700'
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Time range */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 uppercase tracking-wide">Since</span>
            <select
              value={since}
              onChange={(e) => onSinceChange(e.target.value)}
              className="input py-0.5 px-2 text-xs bg-gray-800 border-gray-700 rounded"
            >
              {TIME_RANGES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search logs..."
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="input pl-8 py-1 text-xs w-full"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
