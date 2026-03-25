import { useQuery } from '@tanstack/react-query';
import { dashboard } from '@/lib/api';
import { Globe, AlertTriangle, ArrowDown, Activity, Rocket, Server } from 'lucide-react';
import clsx from 'clsx';

interface MetricCardProps {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  color?: string;
}

function MetricCard({ label, value, icon, color = 'text-gray-400' }: MetricCardProps) {
  return (
    <div className="card p-4 flex items-center gap-4">
      <div className={clsx('p-2.5 rounded-lg bg-gray-800', color)}>{icon}</div>
      <div>
        <p className="text-2xl font-bold text-gray-100">{value}</p>
        <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      </div>
    </div>
  );
}

function MetricSkeleton() {
  return (
    <div className="card p-4 flex items-center gap-4">
      <div className="skeleton w-10 h-10 rounded-lg" />
      <div className="space-y-2">
        <div className="skeleton w-12 h-6 rounded" />
        <div className="skeleton w-20 h-3 rounded" />
      </div>
    </div>
  );
}

export default function MetricsSummary() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: dashboard.summary,
    refetchInterval: 10_000,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <MetricSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card p-4 text-center text-red-400">
        Failed to load dashboard metrics
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      <MetricCard
        label="Services Total"
        value={data.totalServices}
        icon={<Globe size={20} />}
        color="text-blue-400"
      />
      <MetricCard
        label="Currently Down"
        value={data.serviceStatus?.down ?? 0}
        icon={<ArrowDown size={20} />}
        color={(data.serviceStatus?.down ?? 0) > 0 ? 'text-red-400' : 'text-gray-400'}
      />
      <MetricCard
        label="Degraded"
        value={data.serviceStatus?.degraded ?? 0}
        icon={<Activity size={20} />}
        color={(data.serviceStatus?.degraded ?? 0) > 0 ? 'text-amber-400' : 'text-gray-400'}
      />
      <MetricCard
        label="Incidents (24h)"
        value={data.incidentsLast24h}
        icon={<AlertTriangle size={20} />}
        color={data.incidentsLast24h > 0 ? 'text-amber-400' : 'text-gray-400'}
      />
      <MetricCard
        label="Active Deploys"
        value={data.activeDeployments}
        icon={<Rocket size={20} />}
        color="text-purple-400"
      />
      <MetricCard
        label="Agents Online"
        value={`${data.agentStatus?.online ?? 0}/${data.agentStatus?.total ?? 0}`}
        icon={<Server size={20} />}
        color={(data.agentStatus?.online ?? 0) > 0 ? 'text-emerald-400' : 'text-gray-400'}
      />
    </div>
  );
}
