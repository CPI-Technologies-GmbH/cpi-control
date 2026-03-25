import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useIncidents } from '@/hooks/useIncidents';
import { useIncidentFilterStore } from '@/stores/filterStore';
import {
  AlertTriangle,
  AlertCircle,
  Info,
  Filter,
  X,
  Search,
  Clock,
  ChevronRight,
} from 'lucide-react';
import { severityColor, statusBgColor, formatRelativeTime } from '@/lib/formatters';
import clsx from 'clsx';
import type { IncidentSeverity, IncidentStatus } from '@/types';

const severityOptions: IncidentSeverity[] = ['critical', 'warning', 'info'];
const statusOptions: IncidentStatus[] = ['open', 'acknowledged', 'resolved'];

function SeverityIcon({ severity }: { severity: IncidentSeverity }) {
  switch (severity) {
    case 'critical':
      return <AlertCircle size={16} className="text-red-400" />;
    case 'warning':
      return <AlertTriangle size={16} className="text-amber-400" />;
    case 'info':
      return <Info size={16} className="text-blue-400" />;
  }
}

export default function IncidentListPage() {
  const [showFilters, setShowFilters] = useState(false);
  const filters = useIncidentFilterStore();

  const apiFilters = {
    ...(filters.severity.length > 0 && { severity: filters.severity }),
    ...(filters.status.length > 0 && { status: filters.status }),
    ...(filters.search && { search: filters.search }),
    ...(filters.serviceId && { serviceId: filters.serviceId }),
    ...(filters.customerId && { customerId: filters.customerId }),
  };

  const { data: incidents, isLoading, error } = useIncidents(apiFilters);

  const hasFilters = filters.severity.length > 0 || filters.status.length > 0 || !!filters.search;

  function toggleFilter<T>(key: 'severity' | 'status', value: T) {
    const current = filters[key] as T[];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    filters.setFilter(key, next as typeof filters[typeof key]);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertTriangle size={20} className="text-amber-400" />
          <h1 className="text-xl font-bold text-gray-100">Incidents</h1>
          {incidents && <span className="text-sm text-gray-500">({incidents.length})</span>}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search incidents..."
            value={filters.search}
            onChange={(e) => filters.setFilter('search', e.target.value)}
            className="input pl-9 py-2 text-sm"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={clsx(
            'btn-ghost py-2 text-sm flex items-center gap-1.5',
            showFilters && 'bg-gray-800'
          )}
        >
          <Filter size={14} />
          Filters
          {hasFilters && <span className="w-2 h-2 bg-blue-500 rounded-full" />}
        </button>
        {hasFilters && (
          <button
            onClick={() => filters.resetFilters()}
            className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1"
          >
            <X size={14} />
            Clear
          </button>
        )}
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="card p-4 space-y-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Severity</p>
            <div className="flex flex-wrap gap-2">
              {severityOptions.map((s) => (
                <button
                  key={s}
                  onClick={() => toggleFilter('severity', s)}
                  className={clsx(
                    'badge cursor-pointer transition-colors',
                    filters.severity.includes(s)
                      ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                      : 'bg-gray-800 text-gray-400 border-gray-700'
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Status</p>
            <div className="flex flex-wrap gap-2">
              {statusOptions.map((s) => (
                <button
                  key={s}
                  onClick={() => toggleFilter('status', s)}
                  className={clsx(
                    'badge cursor-pointer transition-colors',
                    filters.status.includes(s)
                      ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                      : 'bg-gray-800 text-gray-400 border-gray-700'
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="card p-6 text-center text-red-400">Failed to load incidents</div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card p-4 flex items-center gap-4">
              <div className="skeleton w-5 h-5 rounded" />
              <div className="flex-1 space-y-1.5">
                <div className="skeleton w-64 h-4 rounded" />
                <div className="skeleton w-32 h-3 rounded" />
              </div>
              <div className="skeleton w-20 h-5 rounded-full" />
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {incidents && incidents.length === 0 && !isLoading && (
        <div className="card p-12 text-center">
          <AlertTriangle size={32} className="mx-auto text-gray-600 mb-3" />
          <p className="text-gray-400">No incidents found</p>
          <p className="text-sm text-gray-600 mt-1">
            {hasFilters ? 'Try adjusting your filters' : 'All systems operational'}
          </p>
        </div>
      )}

      {/* List */}
      {incidents && incidents.length > 0 && (
        <div className="space-y-2">
          {incidents.map((incident) => (
            <Link
              key={incident.id}
              to={`/incidents/${incident.id}`}
              className="card-hover p-4 flex items-center gap-4 group block"
            >
              <SeverityIcon severity={incident.severity} />
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium text-gray-200 group-hover:text-blue-400 transition-colors">
                  {incident.title}
                </h3>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs text-gray-500">
                    {incident.serviceName || 'Unknown'} &middot; {incident.customerName || ''}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-gray-500">
                    <Clock size={10} />
                    {formatRelativeTime(incident.detectedAt)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={clsx('badge text-[10px]', severityColor(incident.severity))}>
                  {incident.severity}
                </span>
                <span className={clsx('badge text-[10px]', statusBgColor(incident.status))}>
                  {incident.status}
                </span>
              </div>
              <ChevronRight size={16} className="text-gray-600 group-hover:text-gray-400 flex-shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
