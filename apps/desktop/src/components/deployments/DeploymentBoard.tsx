import { useState } from 'react';
import { useDeployments } from '@/hooks/useDeployments';
import { useDeploymentFilterStore } from '@/stores/filterStore';
import DeploymentRow from './DeploymentRow';
import { ProviderIcon } from '@/components/icons/ProviderIcons';
import { Rocket, Filter, X, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import type { DeploymentStatus, DeploymentProvider, Environment } from '@/types';
import { providerActiveColor, providerLabel } from '@/lib/formatters';

const statusOptions: DeploymentStatus[] = ['pending', 'building', 'deploying', 'success', 'failed', 'cancelled'];
const providerOptions: DeploymentProvider[] = ['vercel', 'github_actions', 'semaphore', 'kubernetes'];
const envOptions: Environment[] = ['production', 'staging', 'development'];

export default function DeploymentBoard() {
  const [showFilters, setShowFilters] = useState(false);
  const filters = useDeploymentFilterStore();

  const apiFilters = {
    ...(filters.status.length > 0 && { status: filters.status }),
    ...(filters.provider.length > 0 && { provider: filters.provider }),
    ...(filters.environment.length > 0 && { environment: filters.environment }),
    ...(filters.serviceId && { serviceId: filters.serviceId }),
  };

  const { data: deployments, isLoading, error, refetch } = useDeployments(apiFilters);

  const hasFilters =
    filters.status.length > 0 ||
    filters.provider.length > 0 ||
    filters.environment.length > 0;

  function toggleFilter<T>(
    key: 'status' | 'provider' | 'environment',
    value: T
  ) {
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
          <Rocket size={20} className="text-purple-400" />
          <h1 className="text-xl font-bold text-gray-100">Deployments</h1>
          {deployments && (
            <span className="text-sm text-gray-500">({deployments.length})</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="btn-ghost py-1.5 text-sm flex items-center gap-1.5"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={clsx(
              'btn-ghost py-1.5 text-sm flex items-center gap-1.5',
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
      </div>

      {/* Provider quick-filter pills (always visible) */}
      <div className="flex flex-wrap items-center gap-2">
        {providerOptions.map((p) => (
          <button
            key={p}
            onClick={() => toggleFilter('provider', p)}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border cursor-pointer transition-colors',
              filters.provider.includes(p)
                ? providerActiveColor(p)
                : 'bg-gray-800/60 text-gray-400 border-gray-700 hover:bg-gray-800'
            )}
          >
            <ProviderIcon provider={p} size={12} />
            {providerLabel(p)}
          </button>
        ))}
        {filters.provider.length > 0 && (
          <button
            onClick={() => filters.setFilter('provider', [])}
            className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1 ml-1"
          >
            <X size={12} />
            Clear
          </button>
        )}
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="card p-4 space-y-4">
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
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Source</p>
            <div className="flex flex-wrap gap-2">
              {providerOptions.map((p) => (
                <button
                  key={p}
                  onClick={() => toggleFilter('provider', p)}
                  className={clsx(
                    'badge cursor-pointer transition-colors flex items-center gap-1.5',
                    filters.provider.includes(p)
                      ? providerActiveColor(p)
                      : 'bg-gray-800 text-gray-400 border-gray-700'
                  )}
                >
                  <ProviderIcon provider={p} size={12} />
                  {providerLabel(p)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Environment</p>
            <div className="flex flex-wrap gap-2">
              {envOptions.map((e) => (
                <button
                  key={e}
                  onClick={() => toggleFilter('environment', e)}
                  className={clsx(
                    'badge cursor-pointer transition-colors',
                    filters.environment.includes(e)
                      ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                      : 'bg-gray-800 text-gray-400 border-gray-700'
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="card p-6 text-center text-red-400">Failed to load deployments</div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="card overflow-hidden">
          <table className="w-full">
            <tbody>
              {Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-800/50">
                  <td className="px-4 py-4" colSpan={7}>
                    <div className="skeleton w-full h-8 rounded" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty */}
      {deployments && deployments.length === 0 && !isLoading && (
        <div className="card p-12 text-center">
          <Rocket size={32} className="mx-auto text-gray-600 mb-3" />
          <p className="text-gray-400">No deployments found</p>
          <p className="text-sm text-gray-600 mt-1">
            Deployments will appear here as they are detected
          </p>
        </div>
      )}

      {/* Table */}
      {deployments && deployments.length > 0 && (
        <div className="card overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/50 text-left">
                <th className="px-4 py-3 text-xs text-gray-500 uppercase tracking-wide font-medium">
                  Service
                </th>
                <th className="px-4 py-3 text-xs text-gray-500 uppercase tracking-wide font-medium">
                  Last Commit
                </th>
                <th className="px-4 py-3 text-xs text-gray-500 uppercase tracking-wide font-medium">
                  CI Status
                </th>
                <th className="px-4 py-3 text-xs text-gray-500 uppercase tracking-wide font-medium">
                  CI Duration
                </th>
                <th className="px-4 py-3 text-xs text-gray-500 uppercase tracking-wide font-medium">
                  Deployment
                </th>
                <th className="px-4 py-3 text-xs text-gray-500 uppercase tracking-wide font-medium">
                  Link
                </th>
                <th className="px-4 py-3 text-xs text-gray-500 uppercase tracking-wide font-medium">
                  Correlations
                </th>
              </tr>
            </thead>
            <tbody>
              {deployments.map((dep) => (
                <DeploymentRow key={dep.id} deployment={dep} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
