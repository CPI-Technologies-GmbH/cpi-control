import { useState } from 'react';
import { useServices } from '@/hooks/useServices';
import { useUIStore } from '@/stores/uiStore';
import MetricsSummary from './MetricsSummary';
import StatusCard, { StatusCardSkeleton } from './StatusCard';
import DashboardIncidentList from './IncidentList';
import { Filter, X, Search } from 'lucide-react';
import clsx from 'clsx';
import type { Environment, HostingType, ServiceStatus, ServiceFilters } from '@/types';

const environments: Environment[] = ['production', 'staging', 'development'];
const hostingTypes: HostingType[] = ['vercel', 'kubernetes', 'digitalocean', 'ovh', 'github', 'aws', 'docker', 'other'];
const statuses: ServiceStatus[] = ['healthy', 'degraded', 'down', 'unknown'];

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'badge cursor-pointer transition-colors',
        active
          ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
          : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-600'
      )}
    >
      {label}
    </button>
  );
}

export default function OverviewGrid() {
  const activeFilters = useUIStore((s) => s.activeFilters);
  const setFilter = useUIStore((s) => s.setFilter);
  const resetFilters = useUIStore((s) => s.resetFilters);
  const [showFilters, setShowFilters] = useState(false);

  const apiFilters: ServiceFilters = {
    ...(activeFilters.projectId && { projectId: activeFilters.projectId }),
    ...(activeFilters.environments.length > 0 && { environments: activeFilters.environments }),
    ...(activeFilters.hostingTypes.length > 0 && { hostingTypes: activeFilters.hostingTypes }),
    ...(activeFilters.statuses.length > 0 && { statuses: activeFilters.statuses }),
    ...(activeFilters.hasOpenIncident !== undefined && {
      hasOpenIncident: activeFilters.hasOpenIncident,
    }),
    ...(activeFilters.search && { search: activeFilters.search }),
  };

  const { data: services, isLoading, error } = useServices(apiFilters);

  const hasActiveFilters =
    activeFilters.environments.length > 0 ||
    activeFilters.hostingTypes.length > 0 ||
    activeFilters.statuses.length > 0 ||
    activeFilters.search !== '' ||
    activeFilters.hasOpenIncident !== undefined;

  function toggleArrayFilter<T>(
    key: 'environments' | 'hostingTypes' | 'statuses',
    value: T
  ) {
    const current = activeFilters[key] as T[];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    setFilter(key, next as typeof activeFilters[typeof key]);
  }

  return (
    <div className="space-y-6">
      {/* Metrics bar */}
      <MetricsSummary />

      {/* Filter bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Filter services..."
              value={activeFilters.search}
              onChange={(e) => setFilter('search', e.target.value)}
              className="input pl-9 py-1.5 text-sm w-64"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={clsx(
              'btn-ghost flex items-center gap-2 text-sm py-1.5',
              showFilters && 'bg-gray-800'
            )}
          >
            <Filter size={16} />
            Filters
            {hasActiveFilters && (
              <span className="w-2 h-2 rounded-full bg-blue-500" />
            )}
          </button>
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              <X size={14} />
              Clear
            </button>
          )}
        </div>
        <p className="text-sm text-gray-500">
          {services ? `${services.length} services` : ''}
        </p>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="card p-4 space-y-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Status</p>
            <div className="flex flex-wrap gap-2">
              {statuses.map((s) => (
                <FilterChip
                  key={s}
                  label={s}
                  active={activeFilters.statuses.includes(s)}
                  onClick={() => toggleArrayFilter('statuses', s)}
                />
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Environment</p>
            <div className="flex flex-wrap gap-2">
              {environments.map((e) => (
                <FilterChip
                  key={e}
                  label={e}
                  active={activeFilters.environments.includes(e)}
                  onClick={() => toggleArrayFilter('environments', e)}
                />
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Hosting</p>
            <div className="flex flex-wrap gap-2">
              {hostingTypes.map((h) => (
                <FilterChip
                  key={h}
                  label={h}
                  active={activeFilters.hostingTypes.includes(h)}
                  onClick={() => toggleArrayFilter('hostingTypes', h)}
                />
              ))}
            </div>
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={activeFilters.hasOpenIncident ?? false}
                onChange={(e) =>
                  setFilter('hasOpenIncident', e.target.checked ? true : undefined)
                }
                className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500/50"
              />
              Has open incident
            </label>
          </div>
        </div>
      )}

      {/* Main grid + sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Service cards */}
        <div className="lg:col-span-3">
          {error && (
            <div className="card p-8 text-center text-red-400">
              Failed to load services. Please check the backend connection.
            </div>
          )}

          {isLoading && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 9 }).map((_, i) => (
                <StatusCardSkeleton key={i} />
              ))}
            </div>
          )}

          {services && services.length === 0 && !isLoading && (
            <div className="card p-12 text-center">
              <p className="text-gray-400 mb-2">No services found</p>
              <p className="text-sm text-gray-600">
                {hasActiveFilters
                  ? 'Try adjusting your filters'
                  : 'Add a project and service to get started'}
              </p>
            </div>
          )}

          {services && services.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {services.map((s) => (
                <StatusCard key={s.id} service={s} />
              ))}
            </div>
          )}
        </div>

        {/* Sidebar: Incidents */}
        <div className="lg:col-span-1">
          <DashboardIncidentList />
        </div>
      </div>
    </div>
  );
}
