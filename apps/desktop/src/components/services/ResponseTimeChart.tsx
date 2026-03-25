import { useState, useMemo } from 'react';
import { useServiceHealth } from '@/hooks/useServices';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
} from 'recharts';
import { subHours, subDays, parseISO, format } from 'date-fns';
import clsx from 'clsx';
import type { HealthCheckResult } from '@/types';

interface Props {
  serviceId: string;
  degradedThresholdMs?: number;
}

type TimeRange = '1h' | '6h' | '24h' | '7d';

const rangeOffsets: Record<TimeRange, () => Date> = {
  '1h': () => subHours(new Date(), 1),
  '6h': () => subHours(new Date(), 6),
  '24h': () => subDays(new Date(), 1),
  '7d': () => subDays(new Date(), 7),
};

export default function ResponseTimeChart({ serviceId, degradedThresholdMs = 2000 }: Props) {
  const [range, setRange] = useState<TimeRange>('24h');

  const since = useMemo(() => rangeOffsets[range]().toISOString(), [range]);

  const { data: checks, isLoading, error } = useServiceHealth(serviceId, { since });

  const chartData = useMemo(() => {
    if (!checks) return [];
    return checks
      .filter((c: HealthCheckResult) => c.responseTimeMs !== null && c.responseTimeMs !== undefined)
      .map((c: HealthCheckResult) => ({
        time: c.checkedAt,
        responseTime: c.responseTimeMs,
        status: c.status,
      }))
      .sort((a: any, b: any) => new Date(a.time).getTime() - new Date(b.time).getTime());
  }, [checks]);

  function formatTick(iso: string) {
    try {
      const d = parseISO(iso);
      if (range === '1h' || range === '6h') return format(d, 'HH:mm');
      if (range === '24h') return format(d, 'HH:mm');
      return format(d, 'MMM d');
    } catch {
      return '';
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-300">Response Time</h3>
        <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-0.5">
          {(['1h', '6h', '24h', '7d'] as TimeRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={clsx(
                'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                range === r
                  ? 'bg-gray-700 text-gray-200'
                  : 'text-gray-500 hover:text-gray-300'
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <div className="skeleton w-full h-48 rounded-lg" />}

      {error && (
        <div className="p-6 text-center text-sm text-red-400">Failed to load response data</div>
      )}

      {!isLoading && chartData.length === 0 && (
        <div className="p-6 text-center text-sm text-gray-500 bg-gray-800/30 rounded-lg h-48 flex items-center justify-center">
          No response time data for this period
        </div>
      )}

      {!isLoading && chartData.length > 0 && (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="time"
              tickFormatter={formatTick}
              tick={{ fill: '#6b7280', fontSize: 11 }}
              axisLine={{ stroke: '#374151' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: '#6b7280', fontSize: 11 }}
              axisLine={{ stroke: '#374151' }}
              tickLine={false}
              tickFormatter={(v: number) => `${v}ms`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1f2937',
                border: '1px solid #374151',
                borderRadius: '8px',
                fontSize: '12px',
              }}
              labelFormatter={(label: string) => {
                try {
                  return format(parseISO(label), 'MMM d, HH:mm:ss');
                } catch {
                  return label;
                }
              }}
              formatter={(value: number) => [`${value}ms`, 'Response Time']}
            />
            <ReferenceLine
              y={degradedThresholdMs}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              label={{
                value: 'Degraded',
                fill: '#f59e0b',
                fontSize: 10,
                position: 'right',
              }}
            />
            <Line
              type="monotone"
              dataKey="responseTime"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: '#3b82f6' }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
