import { Link } from 'react-router-dom';
import { AlertTriangle, AlertCircle, Info, Clock } from 'lucide-react';
import { useIncidents } from '@/hooks/useIncidents';
import { severityColor, formatRelativeTime } from '@/lib/formatters';
import clsx from 'clsx';
import type { IncidentSeverity } from '@/types';

function SeverityIcon({ severity }: { severity: IncidentSeverity }) {
  switch (severity) {
    case 'critical':
      return <AlertCircle size={14} className="text-red-400" />;
    case 'warning':
      return <AlertTriangle size={14} className="text-amber-400" />;
    case 'info':
      return <Info size={14} className="text-blue-400" />;
  }
}

function IncidentSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3">
      <div className="skeleton w-5 h-5 rounded" />
      <div className="flex-1 space-y-1.5">
        <div className="skeleton w-48 h-4 rounded" />
        <div className="skeleton w-24 h-3 rounded" />
      </div>
      <div className="skeleton w-16 h-3 rounded" />
    </div>
  );
}

export default function DashboardIncidentList() {
  const { data: incidents, isLoading, error } = useIncidents({ status: ['open', 'acknowledged'] });

  return (
    <div className="card">
      <div className="flex items-center justify-between p-4 border-b border-gray-700/50">
        <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-400" />
          Active Incidents
        </h2>
        <Link to="/incidents" className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
          View all
        </Link>
      </div>

      <div className="divide-y divide-gray-800/50">
        {isLoading &&
          Array.from({ length: 4 }).map((_, i) => <IncidentSkeleton key={i} />)}

        {error && (
          <div className="p-4 text-sm text-red-400">Failed to load incidents</div>
        )}

        {incidents && incidents.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-500">
            No active incidents. All systems operational.
          </div>
        )}

        {incidents?.slice(0, 8).map((incident) => (
          <Link
            key={incident.id}
            to={`/incidents/${incident.id}`}
            className="flex items-center gap-3 p-3 hover:bg-gray-800/30 transition-colors"
          >
            <SeverityIcon severity={incident.severity} />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-200 truncate">{incident.title}</p>
              <p className="text-xs text-gray-500">
                {incident.serviceName || 'Unknown'} &middot;{' '}
                <span className={clsx('badge text-[10px] py-0', severityColor(incident.severity))}>
                  {incident.severity}
                </span>
              </p>
            </div>
            <div className="flex items-center gap-1 text-xs text-gray-500 flex-shrink-0">
              <Clock size={12} />
              {formatRelativeTime(incident.detectedAt)}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
