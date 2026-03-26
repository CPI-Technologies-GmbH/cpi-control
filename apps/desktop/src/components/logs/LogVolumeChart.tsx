import { useState, useMemo } from 'react';
import { BarChart3, ChevronDown, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import type { LogEntry, Service } from '@/types';
import { getServiceBarColor } from './ServiceMultiSelect';

/** Visible time window options — bars are always per-minute */
type TimeWindow = '5m' | '15m' | '1h';

const WINDOW_OPTIONS: { value: TimeWindow; label: string }[] = [
  { value: '5m', label: '5 min' },
  { value: '15m', label: '15 min' },
  { value: '1h', label: '1 hour' },
];

function windowMinutes(w: TimeWindow): number {
  switch (w) {
    case '5m': return 5;
    case '15m': return 15;
    case '1h': return 60;
  }
}

interface LogVolumeChartProps {
  entries: LogEntry[];
  services: Service[];
  selectedServiceIds: string[];
  allServiceIds: string[];
  onClickServiceSegment?: (serviceId: string) => void;
}

interface BucketData {
  time: number;
  label: string;
  segments: { serviceId: string; count: number }[];
  total: number;
}

export default function LogVolumeChart({
  entries,
  services,
  selectedServiceIds,
  allServiceIds,
  onClickServiceSegment,
}: LogVolumeChartProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [window, setWindow] = useState<TimeWindow>('5m');

  const bucketData = useMemo(() => {
    const mins = windowMinutes(window);
    const bucketMs = 60 * 1000; // always 1-minute buckets
    const now = Date.now();

    // Align to minute boundaries
    const endTime = Math.ceil(now / bucketMs) * bucketMs;
    const startTime = endTime - mins * bucketMs;

    // Pre-compute entry timestamps
    const entryTimes = entries.map((e) => ({
      ts: new Date(e.timestamp).getTime(),
      serviceId: (e.metadata?.serviceId as string) || `source:${e.source}`,
    }));

    const result: BucketData[] = [];
    for (let t = startTime; t < endTime; t += bucketMs) {
      const tEnd = t + bucketMs;

      const segmentCounts = new Map<string, number>();
      let total = 0;
      for (const e of entryTimes) {
        if (e.ts >= t && e.ts < tEnd) {
          segmentCounts.set(e.serviceId, (segmentCounts.get(e.serviceId) || 0) + 1);
          total++;
        }
      }

      const segments = Array.from(segmentCounts.entries())
        .map(([serviceId, count]) => ({ serviceId, count }))
        .sort((a, b) => a.serviceId.localeCompare(b.serviceId));

      const date = new Date(t);
      const label = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

      result.push({ time: t, label, segments, total });
    }

    return result;
  }, [entries, window]);

  const maxTotal = useMemo(() => {
    return Math.max(1, ...bucketData.map((b) => b.total));
  }, [bucketData]);

  if (entries.length === 0) return null;

  // Show fewer axis labels when there are many buckets
  const labelInterval = bucketData.length > 30 ? 10 : bucketData.length > 15 ? 5 : bucketData.length > 8 ? 2 : 1;

  return (
    <div className="card flex-shrink-0 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-gray-800/30 transition-colors"
      >
        {collapsed ? <ChevronRight size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
        <BarChart3 size={14} className="text-gray-400" />
        <span className="text-xs font-medium text-gray-300">Log Volume</span>
        <span className="text-[10px] text-gray-600 ml-1">({entries.length} entries)</span>

        {/* Window selector */}
        <div className="ml-auto flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setWindow(opt.value)}
              className={clsx(
                'px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors',
                window === opt.value
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'text-gray-600 hover:text-gray-400'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </button>

      {/* Chart */}
      {!collapsed && bucketData.length > 0 && (
        <div className="px-4 pb-3">
          <div className="flex items-end gap-px h-16">
            {bucketData.map((b, i) => (
              <div
                key={i}
                className="flex-1 flex flex-col justify-end min-w-[2px] relative group"
                style={{ height: '100%' }}
              >
                {/* Stacked bar */}
                <div
                  className="w-full flex flex-col justify-end rounded-t-[1px] overflow-hidden"
                  style={{ height: `${Math.max((b.total / maxTotal) * 100, b.total > 0 ? 4 : 0)}%` }}
                >
                  {b.segments.map((seg) => {
                    const pct = b.total > 0 ? (seg.count / b.total) * 100 : 0;
                    const color = getServiceBarColor(seg.serviceId, allServiceIds);
                    return (
                      <div
                        key={seg.serviceId}
                        className="w-full cursor-pointer hover:brightness-125 transition-all"
                        style={{
                          height: `${pct}%`,
                          minHeight: seg.count > 0 ? '1px' : '0px',
                          backgroundColor: color,
                          opacity: 0.8,
                        }}
                        onClick={() => onClickServiceSegment?.(seg.serviceId)}
                      />
                    );
                  })}
                </div>

                {/* Empty minute indicator */}
                {b.total === 0 && (
                  <div className="w-full h-[1px] bg-gray-800 rounded" />
                )}

                {/* Tooltip */}
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                  <div className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-[10px] whitespace-nowrap shadow-lg">
                    <div className="text-gray-300 font-medium">{b.label}</div>
                    <div className="text-gray-500">{b.total} entries</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Time axis labels */}
          <div className="flex mt-1">
            {bucketData.map((b, i) => (
              <div key={i} className="flex-1 text-center">
                {i % labelInterval === 0 && (
                  <span className="text-[9px] text-gray-600">{b.label}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
