import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { logs as api, services as servicesApi, BASE_URL } from '@/lib/api';
import type { LogEntry, LogSource, LogLevel, Service } from '@/types';
import { DEFAULT_COLUMNS, type LogColumn } from './ColumnSelector';
import LogToolbar from './LogToolbar';
import LogTable from './LogTable';
import LogVolumeChart from './LogVolumeChart';
import LogServiceSidebar from './LogServiceSidebar';

// ─── Constants ──────────────────────────────────────────────────────────────

const ALL_SOURCES: LogSource[] = ['kubernetes', 'vercel', 'github', 'agent', 'backend'];
const ALL_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const MAX_ENTRIES = 5000;
const DEBOUNCE_MS = 300;

// ─── Helpers ────────────────────────────────────────────────────────────────

function useDebounce(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// Deduplicate entries by id (SSE may resend same entries on reconnect)
function dedupeEntries(entries: LogEntry[]): LogEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const key = e.id || `${e.timestamp}-${e.message?.slice(0, 50)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function LogViewer({ initialServiceId }: { initialServiceId?: string } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const isEmbedded = !!initialServiceId;

  // ── Service multi-select state ────────────────────────────────────────
  const urlServiceId = initialServiceId || searchParams.get('serviceId') || '';
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(
    urlServiceId ? [urlServiceId] : []
  );

  // Fetch available services
  const { data: servicesList = [] } = useQuery({
    queryKey: ['services-for-log-filter'],
    queryFn: () => servicesApi.list(),
    staleTime: 60_000,
  });

  // All service IDs for color assignment
  const allServiceIds = servicesList.map((s: Service) => s.id);

  // Sync URL (skip in embedded mode)
  useEffect(() => {
    if (isEmbedded) return;
    const next = new URLSearchParams(searchParams);
    next.delete('serviceId');
    if (selectedServiceIds.length > 0 && selectedServiceIds.length < servicesList.length) {
      selectedServiceIds.forEach((id) => next.append('serviceId', id));
    }
    setSearchParams(next, { replace: true });
  }, [selectedServiceIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filter state ──────────────────────────────────────────────────────
  const [sources, setSources] = useState<LogSource[]>(['kubernetes', 'backend', 'agent']);
  const [levels, setLevels] = useState<LogLevel[]>(['info', 'warn', 'error']);
  const [since, setSince] = useState<string>('1h');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, DEBOUNCE_MS);

  // ── Column state (persisted to localStorage) ─────────────────────────
  const [visibleColumns, setVisibleColumns] = useState<LogColumn[]>(() => {
    try {
      const saved = localStorage.getItem('opsboard:log-columns');
      if (saved) return JSON.parse(saved) as LogColumn[];
    } catch { /* ignore */ }
    return DEFAULT_COLUMNS;
  });
  useEffect(() => {
    localStorage.setItem('opsboard:log-columns', JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  // ── Live tail / UI state ──────────────────────────────────────────────
  const [showSidebar, setShowSidebar] = useState(true);
  const [liveTail, setLiveTail] = useState(true); // ON by default
  const [rawEntries, setRawEntries] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const eventSourceRef = useRef<EventSource | null>(null);
  const historicalLoadedRef = useRef(false);

  // ── Historical Data (one-time load on mount + when since changes) ─────

  const { data: historicalData, isLoading, error } = useQuery({
    queryKey: ['logs-historical', since],
    queryFn: () => api.list({ since }),
    staleTime: Infinity, // Only refetch when `since` changes
    refetchInterval: liveTail ? false : 15_000, // Poll when not live-tailing
  });

  // Seed raw entries with historical data
  useEffect(() => {
    if (historicalData && historicalData.length > 0) {
      setRawEntries((prev) => {
        // Merge: historical first, then any live entries that came after
        const merged = [...historicalData, ...prev];
        return dedupeEntries(merged).slice(-MAX_ENTRIES);
      });
      historicalLoadedRef.current = true;
    }
  }, [historicalData]);

  // ── SSE Live Tail ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!liveTail) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }

    // SSE fetches all sources — filtering is done client-side
    const url = `${BASE_URL}/api/logs/stream`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const entry: LogEntry = JSON.parse(event.data);
        setRawEntries((prev) => {
          const next = [...prev, entry];
          return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
        });
      } catch {
        // Ignore malformed SSE data
      }
    };

    es.onerror = () => {
      // EventSource will auto-reconnect
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [liveTail]);

  // ── Client-side Filtering (applies to BOTH historical and live data) ──

  const filteredEntries = useMemo(() => {
    let result = rawEntries;

    // Service filter — when services are selected, only show matching entries
    if (selectedServiceIds.length > 0) {
      const idSet = new Set(selectedServiceIds);
      result = result.filter((e) => {
        const svcId = (e.metadata?.serviceId as string) || '';
        // Entries without serviceId: show when there's a text match in the service name
        if (!svcId) return false;
        return idSet.has(svcId);
      });
    }

    // Source filter
    if (sources.length > 0 && sources.length < ALL_SOURCES.length) {
      result = result.filter((e) => sources.includes(e.source));
    }

    // Level filter
    if (levels.length > 0 && levels.length < ALL_LEVELS.length) {
      result = result.filter((e) => levels.includes(e.level));
    }

    // Search filter
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter(
        (e) =>
          e.message?.toLowerCase().includes(q) ||
          e.source?.toLowerCase().includes(q) ||
          (e.metadata?.serviceId as string)?.toLowerCase().includes(q)
      );
    }

    return result;
  }, [rawEntries, selectedServiceIds, sources, levels, debouncedSearch]);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="flex gap-3 h-[calc(100vh-4rem)]">
      {/* Main content */}
      <div className="flex-1 min-w-0 space-y-3 flex flex-col">
      <LogToolbar
        services={servicesList}
        selectedServiceIds={selectedServiceIds}
        onSelectedServiceIdsChange={setSelectedServiceIds}
        sources={sources}
        onSourcesChange={setSources}
        levels={levels}
        onLevelsChange={setLevels}
        since={since}
        onSinceChange={setSince}
        search={search}
        onSearchChange={setSearch}
        visibleColumns={visibleColumns}
        onColumnsChange={setVisibleColumns}
        liveTail={liveTail}
        onLiveTailToggle={() => {
          setLiveTail((prev) => !prev);
          setAutoScroll(true);
        }}
        entryCount={filteredEntries.length}
        isEmbedded={isEmbedded}
      />

      {/* Error */}
      {error && (
        <div className="card p-4 text-center text-red-400 text-sm flex-shrink-0">
          Failed to load logs
        </div>
      )}

      {/* Volume Chart */}
      <LogVolumeChart
        entries={filteredEntries}
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

      {/* Log Table */}
      <LogTable
        entries={filteredEntries}
        visibleColumns={visibleColumns}
        services={servicesList}
        allServiceIds={allServiceIds}
        isLoading={isLoading && rawEntries.length === 0}
        liveTail={liveTail}
        autoScroll={autoScroll}
        onAutoScrollChange={setAutoScroll}
      />
      </div>

      {/* Service sidebar */}
      {!isEmbedded && showSidebar && (
        <LogServiceSidebar
          services={servicesList}
          selectedIds={selectedServiceIds}
          onChange={setSelectedServiceIds}
          onCollapse={() => setShowSidebar(false)}
        />
      )}

      {/* Sidebar reopen button (when collapsed) */}
      {!isEmbedded && !showSidebar && (
        <button
          onClick={() => setShowSidebar(true)}
          className="flex-shrink-0 self-start mt-1 px-2 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors border border-gray-700 text-xs"
          title="Show services"
        >
          Services
        </button>
      )}
    </div>
  );
}
