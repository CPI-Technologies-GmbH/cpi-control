import { useState } from 'react';
import { useDeployments } from '@/hooks/useDeployments';
import DeploymentRow from '@/components/deployments/DeploymentRow';
import DeploymentDetail from '@/components/deployments/DeploymentDetail';
import { ProviderIcon } from '@/components/icons/ProviderIcons';
import { Rocket, Filter, X, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import type { DeploymentRecord, DeploymentStatus, DeploymentProvider, Environment } from '@/types';
import { providerActiveColor, providerLabel } from '@/lib/formatters';

const statusOptions: DeploymentStatus[] = ['pending', 'building', 'deploying', 'success', 'failed', 'cancelled'];
const providerOptions: DeploymentProvider[] = ['vercel', 'github_actions', 'semaphore', 'kubernetes'];
const envOptions: Environment[] = ['production', 'staging', 'development'];

interface Props {
  projectId: string;
}

export default function ProjectDeployments({ projectId }: Props) {
  const [showFilters, setShowFilters] = useState(false);
  const [selectedDeployment, setSelectedDeployment] = useState<DeploymentRecord | null>(null);
  const [providerFilter, setProviderFilter] = useState<DeploymentProvider[]>([]);
  const [statusFilter, setStatusFilter] = useState<DeploymentStatus[]>([]);
  const [envFilter, setEnvFilter] = useState<Environment[]>([]);

  const apiFilters = {
    projectId,
    ...(statusFilter.length > 0 && { status: statusFilter }),
    ...(providerFilter.length > 0 && { provider: providerFilter }),
    ...(envFilter.length > 0 && { environment: envFilter }),
  };

  const { data: deployments, isLoading, error, refetch } = useDeployments(apiFilters);

  const hasFilters = statusFilter.length > 0 || providerFilter.length > 0 || envFilter.length > 0;

  function toggleProvider(p: DeploymentProvider) {
    setProviderFilter((prev) => prev.includes(p) ? prev.filter((v) => v !== p) : [...prev, p]);
  }

  function toggleStatus(s: DeploymentStatus) {
    setStatusFilter((prev) => prev.includes(s) ? prev.filter((v) => v !== s) : [...prev, s]);
  }

  function toggleEnv(e: Environment) {
    setEnvFilter((prev) => prev.includes(e) ? prev.filter((v) => v !== e) : [...prev, e]);
  }

  function clearAll() {
    setProviderFilter([]);
    setStatusFilter([]);
    setEnvFilter([]);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Rocket size={20} className="text-purple-400" />
          <h2 className="text-lg font-bold text-gray-100">Deployments</h2>
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
              onClick={clearAll}
              className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1"
            >
              <X size={14} />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Provider quick-filter pills */}
      <div className="flex flex-wrap items-center gap-2">
        {providerOptions.map((p) => (
          <button
            key={p}
            onClick={() => toggleProvider(p)}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border cursor-pointer transition-colors',
              providerFilter.includes(p)
                ? providerActiveColor(p)
                : 'bg-gray-800/60 text-gray-400 border-gray-700 hover:bg-gray-800'
            )}
          >
            <ProviderIcon provider={p} size={12} />
            {providerLabel(p)}
          </button>
        ))}
        {providerFilter.length > 0 && (
          <button
            onClick={() => setProviderFilter([])}
            className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1 ml-1"
          >
            <X size={12} />
            Clear
          </button>
        )}
      </div>

      {/* Extended Filters */}
      {showFilters && (
        <div className="card p-4 space-y-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Status</p>
            <div className="flex flex-wrap gap-2">
              {statusOptions.map((s) => (
                <button
                  key={s}
                  onClick={() => toggleStatus(s)}
                  className={clsx(
                    'badge cursor-pointer transition-colors',
                    statusFilter.includes(s)
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
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Environment</p>
            <div className="flex flex-wrap gap-2">
              {envOptions.map((e) => (
                <button
                  key={e}
                  onClick={() => toggleEnv(e)}
                  className={clsx(
                    'badge cursor-pointer transition-colors',
                    envFilter.includes(e)
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
                <DeploymentRow
                  key={dep.id}
                  deployment={dep}
                  onClick={() => setSelectedDeployment(dep)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Panel */}
      {selectedDeployment && (
        <DeploymentDetail
          deployment={selectedDeployment}
          onClose={() => setSelectedDeployment(null)}
        />
      )}
    </div>
  );
}
