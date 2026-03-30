import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { logs as api, services as servicesApi, BASE_URL } from '@/lib/api';
import type { LogEntry, LogSource, LogLevel, Service } from '@/types';
import { DEFAULT_COLUMNS, type LogColumn } from './ColumnSelector';
import LogTable from './LogTable';
import LogVolumeChart from './LogVolumeChart';
import LogServiceSidebar from './LogServiceSidebar';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import clsx from 'clsx';

// ─── Constants ──────────────────────────────────────────────────────────────

const ALL_SOURCES: LogSource[] = ['kubernetes', 'vercel', 'github', 'agent', 'backend'];
const ALL_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const MAX_ENTRIES = 2000;
const DEBOUNCE_MS = 300;

function useDebounce(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function LogLiveWindow() {
  const [searchParams] = useSearchParams();
  const [showFilters, setShowFilters] = useState(true);

  // Parse initial state from URL query params
  const initialServiceIds = searchParams.getAll('serviceId');
  const initialSources = searchParams.getAll('source') as LogSource[];
  const initialLevels = searchParams.getAll('level') as LogLevel[];
  const initialSince = searchParams.get('since') || '1h';
  const initialSearch = searchParams.get('search') || '';
  const initialCols = searchParams.getAll('col') as LogColumn[];

  // State
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(initialServiceIds);
  const [sources, setSources] = useState<LogSource[]>(
    initialSources.length > 0 ? initialSources : ['kubernetes', 'backend', 'agent']
  );
  const [levels, setLevels] = useState<LogLevel[]>(
    initialLevels.length > 0 ? initialLevels : ['info', 'warn', 'error']
  );
  const [since, setSince] = useState(initialSince);
  const [search, setSearch] = useState(initialSearch);
  const debouncedSearch = useDebounce(search, DEBOUNCE_MS);
  const [visibleColumns, setVisibleColumns] = useState<LogColumn[]>(
    initialCols.length > 0 ? initialCols : DEFAULT_COLUMNS
  );
  const [liveTail, setLiveTail] = useState(true); // Live tail on by default
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Fetch services
  const { data: servicesList = [] } = useQuery({
    queryKey: ['services-for-log-filter'],
    queryFn: () => servicesApi.list(),
    staleTime: 60_000,
  });

  const allServiceIds = servicesList.map((s: Service) => s.id);

  // Data fetching
  const filters: Record<string, any> = {
    ...(sources.length > 0 && sources.length < ALL_SOURCES.length && { source: sources }),
    ...(levels.length > 0 && levels.length < ALL_LEVELS.length && { level: levels }),
    since,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(selectedServiceIds.length === 1 && { serviceId: selectedServiceIds[0] }),
  };

  const { data, isLoading } = useQuery({
    queryKey: ['logs-live-window', filters],
    queryFn: () => api.list(filters),
    refetchInterval: liveTail ? false : 15_000,
  });

  useEffect(() => {
    if (data) {
      let filtered = data;
      if (selectedServiceIds.length > 1) {
        filtered = data.filter((entry) => {
          const svcId = (entry.metadata?.serviceId as string) || '';
          if (!svcId) return true;
          return selectedServiceIds.includes(svcId);
        });
      }
      setEntries(filtered.slice(-MAX_ENTRIES));
    }
  }, [data, selectedServiceIds]);

  // SSE Live Tail
  useEffect(() => {
    if (!liveTail) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }

    const params = new URLSearchParams();
    sources.forEach((s) => params.append('source', s));
    levels.forEach((l) => params.append('level', l));
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (selectedServiceIds.length === 1) params.set('serviceId', selectedServiceIds[0]);
    const qs = params.toString();

    const url = `${BASE_URL}/api/logs/stream${qs ? `?${qs}` : ''}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const entry: LogEntry = JSON.parse(event.data);
        if (selectedServiceIds.length > 1) {
          const svcId = (entry.metadata?.serviceId as string) || '';
          if (svcId && !selectedServiceIds.includes(svcId)) return;
        }
        setEntries((prev) => {
          const next = [...prev, entry];
          return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
        });
      } catch {
        // ignore
      }
    };

    es.onerror = () => {};

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [liveTail, sources, levels, debouncedSearch, selectedServiceIds]);

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* Collapsible filter sidebar */}
      <div
        className={clsx(
          'flex flex-col border-r border-gray-800 bg-gray-900 transition-all duration-200 overflow-hidden',
          showFilters ? 'w-80' : 'w-0'
        )}
      >
        {showFilters && (
          <div className="p-4 space-y-4 overflow-y-auto flex-1">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-200">Filters</h2>
              <button
                onClick={() => setShowFilters(false)}
                className="p-1 rounded text-gray-500 hover:text-gray-300 transition-colors"
              >
                <PanelLeftClose size={16} />
              </button>
            </div>

            {/* Filter controls */}
            <div className="space-y-3">
              <div>
                <span className="text-[10px] text-gray-500 uppercase tracking-wide block mb-1">Sources</span>
                <div className="flex flex-wrap gap-1">
                  {ALL_SOURCES.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        if (sources.includes(s)) {
                          setSources(sources.filter((x) => x !== s));
                        } else {
                          setSources([...sources, s]);
                        }
                      }}
                      className={clsx(
                        'px-2 py-0.5 rounded text-[10px] font-medium transition-colors border',
                        sources.includes(s)
                          ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                          : 'bg-gray-800 text-gray-600 border-gray-700'
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-[10px] text-gray-500 uppercase tracking-wide block mb-1">Levels</span>
                <div className="flex flex-wrap gap-1">
                  {ALL_LEVELS.map((l) => (
                    <button
                      key={l}
                      onClick={() => {
                        if (levels.includes(l)) {
                          setLevels(levels.filter((x) => x !== l));
                        } else {
                          setLevels([...levels, l]);
                        }
                      }}
                      className={clsx(
                        'px-2 py-0.5 rounded text-[10px] font-medium transition-colors border',
                        levels.includes(l)
                          ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                          : 'bg-gray-800 text-gray-600 border-gray-700'
                      )}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-[10px] text-gray-500 uppercase tracking-wide block mb-1">Since</span>
                <select
                  value={since}
                  onChange={(e) => setSince(e.target.value)}
                  className="input py-1 px-2 text-xs bg-gray-800 border-gray-700 rounded w-full"
                >
                  {['5m', '15m', '30m', '1h', '6h', '24h', '7d'].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div>
                <span className="text-[10px] text-gray-500 uppercase tracking-wide block mb-1">Search</span>
                <input
                  type="text"
                  placeholder="Search logs..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="input py-1 px-2 text-xs w-full"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden p-4">
        {/* Minimal header */}
        <div className="flex items-center justify-between mb-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            {!showFilters && (
              <button
                onClick={() => setShowFilters(true)}
                className="p-1.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
              >
                <PanelLeftOpen size={16} />
              </button>
            )}
            <h1 className="text-lg font-bold text-gray-100">Live Logs</h1>
            {entries.length > 0 && (
              <span className="text-sm text-gray-500">({entries.length})</span>
            )}
          </div>
          <button
            onClick={() => {
              setLiveTail((prev) => !prev);
              setAutoScroll(true);
            }}
            className={clsx(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              liveTail
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-gray-800 text-gray-400 border border-gray-700'
            )}
          >
            {liveTail ? 'Pause' : 'Live Tail'}
          </button>
        </div>

        {/* Volume chart */}
        <LogVolumeChart
          entries={entries}
          services={servicesList}
          selectedServiceIds={selectedServiceIds}
          allServiceIds={allServiceIds}
          onClickServiceSegment={(segmentId) => {
            if (!segmentId.startsWith('source:')) {
              if (selectedServiceIds.includes(segmentId)) {
                setSelectedServiceIds(selectedServiceIds.filter((id) => id !== segmentId));
              } else {
                setSelectedServiceIds([...selectedServiceIds, segmentId]);
              }
            }
          }}
        />

        {/* Log table */}
        <div className="flex-1 min-h-0 mt-3">
          <LogTable
            entries={entries}
            visibleColumns={visibleColumns}
            services={servicesList}
            allServiceIds={allServiceIds}
            isLoading={isLoading}
            liveTail={liveTail}
            autoScroll={autoScroll}
            onAutoScrollChange={setAutoScroll}
          />
        </div>
      </div>

      {/* Service sidebar (right) */}
      <LogServiceSidebar
        services={servicesList}
        selectedIds={selectedServiceIds}
        onChange={setSelectedServiceIds}
      />
    </div>
  );
}
