import { useState, useEffect, useRef } from 'react';
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
const MAX_ENTRIES = 2000;
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
    // Remove existing serviceId params
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

  // ── Column state ──────────────────────────────────────────────────────
  const [visibleColumns, setVisibleColumns] = useState<LogColumn[]>(DEFAULT_COLUMNS);

  // ── Live tail / UI state ──────────────────────────────────────────────
  const [liveTail, setLiveTail] = useState(false);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const eventSourceRef = useRef<EventSource | null>(null);

  // ── Data Fetching ─────────────────────────────────────────────────────

  const filters: Record<string, any> = {
    ...(sources.length > 0 && sources.length < ALL_SOURCES.length && { source: sources }),
    ...(levels.length > 0 && levels.length < ALL_LEVELS.length && { level: levels }),
    since,
    ...(debouncedSearch && { search: debouncedSearch }),
    // For multi-select: if exactly 1 service selected, use backend serviceId filter
    // If multiple, we fetch all and filter client-side
    ...(selectedServiceIds.length === 1 && { serviceId: selectedServiceIds[0] }),
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['logs', filters],
    queryFn: () => api.list(filters),
    refetchInterval: liveTail ? false : 15_000,
  });

  // Sync query data into entries state, apply multi-service filter client-side
  useEffect(() => {
    if (data) {
      let filtered = data;
      // If multiple services are selected, we need to filter client-side
      // since the backend only supports single serviceId
      // Note: entries without serviceId in metadata pass through when filter is active
      if (selectedServiceIds.length > 1) {
        filtered = data.filter((entry) => {
          const svcId = (entry.metadata?.serviceId as string) || '';
          if (!svcId) return true; // Show entries without service association
          return selectedServiceIds.includes(svcId);
        });
      }
      setEntries(filtered.slice(-MAX_ENTRIES));
    }
  }, [data, selectedServiceIds]);

  // ── SSE Live Tail ─────────────────────────────────────────────────────

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
        // Apply multi-service filter for SSE too
        if (selectedServiceIds.length > 1) {
          const svcId = (entry.metadata?.serviceId as string) || '';
          if (svcId && !selectedServiceIds.includes(svcId)) return;
        }
        setEntries((prev) => {
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
  }, [liveTail, sources, levels, debouncedSearch, selectedServiceIds]);

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
        entryCount={entries.length}
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
        entries={entries}
        services={servicesList}
        selectedServiceIds={selectedServiceIds}
        allServiceIds={allServiceIds}
        onClickServiceSegment={(segmentId) => {
          // If it's a real service ID, toggle that service in the filter
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

      {/* Service sidebar (hidden in embedded mode) */}
      {!isEmbedded && (
        <LogServiceSidebar
          services={servicesList}
          selectedIds={selectedServiceIds}
          onChange={setSelectedServiceIds}
        />
      )}
    </div>
  );
}
