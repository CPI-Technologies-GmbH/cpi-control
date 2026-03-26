import { Link } from 'react-router-dom';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import clsx from 'clsx';
import { useProjectStats } from '@/hooks/useProjectStats';
import ProjectStatusTimeline from './ProjectStatusTimeline';
import {
  Server,
  Heart,
  AlertTriangle,
  Clock,
  Shield,
  Rocket,
} from 'lucide-react';
import { ProviderIcon } from '@/components/icons/ProviderIcons';
import {
  formatRelativeTime,
  formatMs,
  severityColor,
  statusBgColor,
  deploymentStatusColor,
} from '@/lib/formatters';

const STATUS_COLORS: Record<string, string> = {
  healthy: '#10b981',
  degraded: '#f59e0b',
  down: '#ef4444',
  unknown: '#6b7280',
};

export default function ProjectDashboard({ projectId }: { projectId: string }) {
  const { data: stats, isLoading } = useProjectStats(projectId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="skeleton h-24 rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="skeleton h-48 rounded-lg" />
          <div className="skeleton h-48 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="card p-8 text-center text-sm text-gray-500">
        No stats available
      </div>
    );
  }

  const donutData = Object.entries(stats.statusBreakdown)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({ name: status, value: count }));

  const uptimeColor =
    stats.uptimePercent30d === null
      ? 'text-gray-400'
      : stats.uptimePercent30d >= 99.9
        ? 'text-emerald-400'
        : stats.uptimePercent30d >= 99
          ? 'text-amber-400'
          : 'text-red-400';

  const uptimeBarColor =
    stats.uptimePercent30d === null
      ? 'bg-gray-600'
      : stats.uptimePercent30d >= 99.9
        ? 'bg-emerald-500'
        : stats.uptimePercent30d >= 99
          ? 'bg-amber-500'
          : 'bg-red-500';

  return (
    <div className="space-y-6">
      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-lg bg-gray-800 text-blue-400">
              <Server size={18} />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-100">{stats.serviceCount}</p>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Services</p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-lg bg-gray-800 text-emerald-400">
              <Heart size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2 text-2xl font-bold">
                <span className="text-emerald-400">{stats.statusBreakdown.healthy}</span>
                {stats.statusBreakdown.degraded > 0 && (
                  <span className="text-amber-400 text-lg">/ {stats.statusBreakdown.degraded}</span>
                )}
                {stats.statusBreakdown.down > 0 && (
                  <span className="text-red-400 text-lg">/ {stats.statusBreakdown.down}</span>
                )}
              </div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Health</p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-4">
            <div className={clsx('p-2.5 rounded-lg bg-gray-800', stats.openIncidents > 0 ? 'text-red-400' : 'text-gray-400')}>
              <AlertTriangle size={18} />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-100">{stats.openIncidents}</p>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Open Incidents</p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-lg bg-gray-800 text-purple-400">
              <Clock size={18} />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-100">
                {formatMs(stats.avgResponseTimeMs)}
              </p>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Avg Response</p>
            </div>
          </div>
        </div>
      </div>

      {/* Uptime + Donut row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Uptime / SLA Card */}
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Shield size={16} className="text-gray-500" />
            <h3 className="text-sm font-medium text-gray-400">Uptime / SLA</h3>
          </div>
          <div className="text-center">
            <p className={clsx('text-5xl font-bold', uptimeColor)}>
              {stats.uptimePercent30d !== null ? `${stats.uptimePercent30d}%` : '—'}
            </p>
            <p className="text-xs text-gray-500 mt-2">Last 30 days</p>
            {stats.uptimePercent30d !== null && (
              <div className="mt-4 w-full bg-gray-800 rounded-full h-2">
                <div
                  className={clsx('h-2 rounded-full transition-all', uptimeBarColor)}
                  style={{ width: `${Math.min(stats.uptimePercent30d, 100)}%` }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Status Distribution Donut */}
        <div className="card p-6">
          <h3 className="text-sm font-medium text-gray-400 mb-4">Status Distribution</h3>
          {donutData.length === 0 ? (
            <div className="text-center text-sm text-gray-500 py-8">No services</div>
          ) : (
            <div className="flex items-center gap-6">
              <div className="w-32 h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutData}
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={55}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {donutData.map((entry) => (
                        <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || '#6b7280'} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                      labelStyle={{ color: '#9ca3af' }}
                      itemStyle={{ color: '#e5e7eb' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-2">
                {donutData.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-2 text-sm">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: STATUS_COLORS[entry.name] }}
                    />
                    <span className="text-gray-400 capitalize">{entry.name}</span>
                    <span className="text-gray-200 font-medium">{entry.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Service Status Timeline */}
      <ProjectStatusTimeline projectId={projectId} />

      {/* Recent Incidents + Deployments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Incidents */}
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={16} className="text-gray-500" />
            <h3 className="text-sm font-medium text-gray-400">Recent Incidents</h3>
          </div>
          {stats.recentIncidents.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No incidents</p>
          ) : (
            <div className="space-y-3">
              {stats.recentIncidents.map((incident) => (
                <Link
                  key={incident.id}
                  to={`/incidents/${incident.id}`}
                  className="block p-3 rounded-lg bg-gray-800/50 hover:bg-gray-800 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={clsx('badge text-xs', severityColor(incident.severity))}>
                          {incident.severity}
                        </span>
                        <span className={clsx('badge text-xs', statusBgColor(incident.status))}>
                          {incident.status}
                        </span>
                      </div>
                      <p className="text-sm text-gray-200 truncate">{incident.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{incident.serviceName}</p>
                    </div>
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      {formatRelativeTime(incident.detectedAt)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Recent Deployments */}
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Rocket size={16} className="text-gray-500" />
            <h3 className="text-sm font-medium text-gray-400">Recent Deployments</h3>
          </div>
          {stats.recentDeployments.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No deployments</p>
          ) : (
            <div className="space-y-3">
              {stats.recentDeployments.map((deploy) => (
                <div
                  key={deploy.id}
                  className="p-3 rounded-lg bg-gray-800/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={clsx('badge text-xs', deploymentStatusColor(deploy.status as any))}>
                          {deploy.status}
                        </span>
                        <ProviderIcon provider={deploy.provider} size={14} />
                      </div>
                      <p className="text-sm text-gray-200">{deploy.serviceName}</p>
                      {deploy.branch && (
                        <p className="text-xs text-gray-500 font-mono mt-0.5">{deploy.branch}</p>
                      )}
                    </div>
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      {formatRelativeTime(deploy.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
