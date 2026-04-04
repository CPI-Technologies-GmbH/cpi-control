import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { parseISO, format, subDays } from 'date-fns';

const BASE_URL = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE_URL) || 'http://localhost:19876';

interface StatusBucketRaw {
  time: string;
  healthy: number;
  degraded: number;
  down: number;
}

interface StatusBucket {
  time: string;
  healthy: number;
  degraded: number;
  down: number;
}

interface Props {
  projectId: string;
}

export default function ProjectStatusTimeline({ projectId }: Props) {
  // Stabilize the since value — round to hour so queryKey stays stable across renders
  const since = useMemo(() => {
    const d = subDays(new Date(), 7);
    d.setMinutes(0, 0, 0);
    return d.toISOString();
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ['project-status-timeline', projectId, since],
    queryFn: async (): Promise<StatusBucket[]> => {
      const sp = new URLSearchParams({ since, bucketMinutes: '60' });
      const res = await fetch(
        `${BASE_URL}/api/inventory/projects/${projectId}/status-timeline?${sp.toString()}`
      );
      if (!res.ok) throw new Error('Failed to fetch status timeline');
      const raw: StatusBucketRaw[] = await res.json();
      // Convert absolute counts to percentages
      return raw.map((b) => {
        const total = b.healthy + b.degraded + b.down;
        if (total === 0) return { time: b.time, healthy: 100, degraded: 0, down: 0 };
        return {
          time: b.time,
          healthy: Math.round((b.healthy / total) * 100),
          degraded: Math.round((b.degraded / total) * 100),
          down: Math.round((b.down / total) * 100),
        };
      });
    },
    enabled: !!projectId,
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });

  if (isLoading) {
    return <div className="skeleton w-full h-40 rounded-lg" />;
  }

  if (error || !data || data.length === 0) {
    return (
      <div className="card p-6 text-center text-sm text-gray-500">
        {error ? 'Failed to load timeline data' : 'No status data available yet — health checks will populate this chart over time'}
      </div>
    );
  }

  return (
    <div className="card p-4">
      <h3 className="text-sm font-medium text-gray-400 mb-4">Service Status (7d)</h3>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="time"
            tickFormatter={(iso: string) => {
              try { return format(parseISO(iso), 'MMM d HH:mm'); } catch { return ''; }
            }}
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={{ stroke: '#374151' }}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={{ stroke: '#374151' }}
            tickLine={false}
            width={40}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1f2937',
              border: '1px solid #374151',
              borderRadius: '8px',
              fontSize: '12px',
            }}
            labelFormatter={(label: string) => {
              try { return format(parseISO(label), 'MMM d, HH:mm'); } catch { return label; }
            }}
          />
          <Area
            type="monotone"
            dataKey="healthy"
            stackId="1"
            stroke="#10b981"
            fill="#10b981"
            fillOpacity={0.6}
            name="Healthy"
          />
          <Area
            type="monotone"
            dataKey="degraded"
            stackId="1"
            stroke="#f59e0b"
            fill="#f59e0b"
            fillOpacity={0.6}
            name="Degraded"
          />
          <Area
            type="monotone"
            dataKey="down"
            stackId="1"
            stroke="#ef4444"
            fill="#ef4444"
            fillOpacity={0.6}
            name="Down"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
