import { useState, useMemo } from 'react';
import { BarChart3, ChevronDown, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import type { LogEntry, Service } from '@/types';
import { getServiceBarColor } from './ServiceMultiSelect';

type TimeBucket = '5m' | '15m' | '1h';

const BUCKET_OPTIONS: { value: TimeBucket; label: string }[] = [
  { value: '5m', label: '5 min' },
  { value: '15m', label: '15 min' },
  { value: '1h', label: '1 hour' },
];

function bucketMs(bucket: TimeBucket): number {
  switch (bucket) {
    case '5m': return 5 * 60 * 1000;
    case '15m': return 15 * 60 * 1000;
    case '1h': return 60 * 60 * 1000;
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
  const [bucket, setBucket] = useState<TimeBucket>('5m');

  const bucketData = useMemo(() => {
    if (entries.length === 0) return [];

    const ms = bucketMs(bucket);

    // Build a map serviceId -> service name from metadata
    const serviceNameMap = new Map<string, string>();
    services.forEach((s) => serviceNameMap.set(s.id, s.name));

    // Determine time range
    const timestamps = entries.map((e) => new Date(e.timestamp).getTime());
    const maxTime = Math.max(...timestamps);
    const minTime = Math.min(...timestamps);

    // Create buckets covering the full range
    const bucketStart = Math.floor(minTime / ms) * ms;
    const bucketEnd = Math.ceil(maxTime / ms) * ms;
    const numBuckets = Math.min(Math.ceil((bucketEnd - bucketStart) / ms) + 1, 60);

    // Build service set from entries metadata — fall back to source as identifier
    const serviceIds = new Set<string>();
    entries.forEach((e) => {
      const svcId = (e.metadata?.serviceId as string) || `source:${e.source}`;
      serviceIds.add(svcId);
    });

    const result: BucketData[] = [];
    for (let i = 0; i < numBuckets; i++) {
      const t = bucketStart + i * ms;
      const bucketEntries = entries.filter((e) => {
        const ts = new Date(e.timestamp).getTime();
        return ts >= t && ts < t + ms;
      });

      const segmentCounts = new Map<string, number>();
      bucketEntries.forEach((e) => {
        const svcId = (e.metadata?.serviceId as string) || `source:${e.source}`;
        segmentCounts.set(svcId, (segmentCounts.get(svcId) || 0) + 1);
      });

      const segments = Array.from(segmentCounts.entries())
        .map(([serviceId, count]) => ({ serviceId, count }))
        .sort((a, b) => a.serviceId.localeCompare(b.serviceId));

      const date = new Date(t);
      const label =
        bucket === '1h'
          ? `${String(date.getHours()).padStart(2, '0')}:00`
          : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

      result.push({
        time: t,
        label,
        segments,
        total: bucketEntries.length,
      });
    }

    return result;
  }, [entries, services, bucket]);

  const maxTotal = useMemo(() => {
    return Math.max(1, ...bucketData.map((b) => b.total));
  }, [bucketData]);

  if (entries.length === 0) return null;

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

        {/* Bucket selector — stop propagation so it doesn't collapse */}
        <div className="ml-auto flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {BUCKET_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setBucket(opt.value)}
              className={clsx(
                'px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors',
                bucket === opt.value
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

                {/* Tooltip */}
                {b.total > 0 && (
                  <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    <div className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-[10px] whitespace-nowrap shadow-lg">
                      <div className="text-gray-300 font-medium">{b.label}</div>
                      <div className="text-gray-500">{b.total} entries</div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Time axis labels */}
          <div className="flex justify-between mt-1">
            {bucketData.length > 0 && (
              <>
                <span className="text-[9px] text-gray-600">{bucketData[0].label}</span>
                {bucketData.length > 2 && (
                  <span className="text-[9px] text-gray-600">
                    {bucketData[Math.floor(bucketData.length / 2)].label}
                  </span>
                )}
                <span className="text-[9px] text-gray-600">
                  {bucketData[bucketData.length - 1].label}
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
