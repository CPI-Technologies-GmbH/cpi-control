import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cronjobs as api } from '@/lib/api';
import { formatRelativeTime } from '@/lib/formatters';
import { Clock, RefreshCw, Filter, X, Box, Globe } from 'lucide-react';
import clsx from 'clsx';
import type { CronJobProvider, CronJobEntry } from '@/types';

const providerOptions: CronJobProvider[] = ['kubernetes', 'vercel'];

function providerLabel(provider: CronJobProvider): string {
  switch (provider) {
    case 'kubernetes':
      return 'Kubernetes';
    case 'vercel':
      return 'Vercel';
    default:
      return provider;
  }
}

function providerBadgeColor(provider: CronJobProvider): string {
  switch (provider) {
    case 'kubernetes':
      return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
    case 'vercel':
      return 'bg-white/10 text-gray-100 border-gray-400/30';
    default:
      return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
  }
}

function providerIcon(provider: CronJobProvider) {
  switch (provider) {
    case 'kubernetes':
      return <Box size={14} className="text-blue-400" />;
    case 'vercel':
      return <Globe size={14} className="text-gray-300" />;
    default:
      return null;
  }
}

/** Convert a cron expression to a rough human-readable string */
function cronToHuman(schedule: string): string {
  if (!schedule) return '';
  const parts = schedule.trim().split(/\s+/);
  if (parts.length < 5) return schedule;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Every minute
  if (minute === '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Every minute';
  }

  // Every N minutes
  if (minute.startsWith('*/') && hour === '*' && dayOfMonth === '*') {
    return `Every ${minute.slice(2)} minutes`;
  }

  // Every hour
  if (minute !== '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Every hour at :${minute.padStart(2, '0')}`;
  }

  // Every N hours
  if (hour.startsWith('*/') && dayOfMonth === '*') {
    return `Every ${hour.slice(2)} hours`;
  }

  // Daily at specific time
  if (minute !== '*' && hour !== '*' && !hour.includes('/') && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Daily at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  }

  // Weekdays
  if (dayOfWeek === '1-5' && dayOfMonth === '*' && month === '*') {
    return `Weekdays at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  }

  return schedule;
}

function statusBadge(entry: CronJobEntry) {
  if (entry.suspended) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border bg-amber-500/10 text-amber-400 border-amber-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        Suspended
      </span>
    );
  }
  if (entry.lastRunStatus === 'failed' || entry.lastRunStatus === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border bg-red-500/10 text-red-400 border-red-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
        Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      Active
    </span>
  );
}

export default function CronJobList() {
  const [providerFilter, setProviderFilter] = useState<CronJobProvider[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const queryFilters = providerFilter.length === 1 ? { provider: providerFilter[0] } : {};

  const { data: cronJobs, isLoading, error, refetch } = useQuery({
    queryKey: ['cronjobs', queryFilters],
    queryFn: () => api.list(queryFilters),
    refetchInterval: 30_000,
  });

  const filteredJobs = cronJobs?.filter((cj) => {
    if (providerFilter.length > 0 && !providerFilter.includes(cj.provider)) {
      return false;
    }
    return true;
  });

  const hasFilters = providerFilter.length > 0;

  function toggleProvider(provider: CronJobProvider) {
    setProviderFilter((prev) =>
      prev.includes(provider)
        ? prev.filter((p) => p !== provider)
        : [...prev, provider]
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Clock size={20} className="text-indigo-400" />
          <h1 className="text-xl font-bold text-gray-100">Cron Jobs</h1>
          {filteredJobs && (
            <span className="text-sm text-gray-500">({filteredJobs.length})</span>
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
              onClick={() => setProviderFilter([])}
              className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1"
            >
              <X size={14} />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="card p-4 space-y-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Provider</p>
            <div className="flex flex-wrap gap-2">
              {providerOptions.map((p) => (
                <button
                  key={p}
                  onClick={() => toggleProvider(p)}
                  className={clsx(
                    'badge cursor-pointer transition-colors',
                    providerFilter.includes(p)
                      ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                      : 'bg-gray-800 text-gray-400 border-gray-700'
                  )}
                >
                  {providerLabel(p)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw size={20} className="animate-spin text-gray-500" />
          <span className="ml-2 text-gray-500">Loading cron jobs...</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="card p-4 border-red-500/20 bg-red-500/5">
          <p className="text-red-400 text-sm">
            Failed to load cron jobs: {(error as Error).message}
          </p>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && filteredJobs?.length === 0 && (
        <div className="card p-8 text-center">
          <Clock size={32} className="mx-auto text-gray-600 mb-3" />
          <p className="text-gray-400 text-sm">No cron jobs found</p>
          <p className="text-gray-600 text-xs mt-1">
            Cron jobs will appear here once Kubernetes or Vercel integrations are configured.
          </p>
        </div>
      )}

      {/* Table */}
      {!isLoading && filteredJobs && filteredJobs.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Provider
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Schedule
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Namespace / Project
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Last Run
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Active Jobs
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {filteredJobs.map((cj) => (
                  <tr
                    key={cj.id}
                    className="hover:bg-gray-800/30 transition-colors"
                  >
                    {/* Name */}
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-gray-100 font-medium">{cj.name}</p>
                        {cj.image && (
                          <p className="text-xs text-gray-500 mt-0.5 truncate max-w-xs" title={cj.image}>
                            {cj.image}
                          </p>
                        )}
                        {cj.path && (
                          <p className="text-xs text-gray-500 mt-0.5 font-mono">
                            {cj.path}
                          </p>
                        )}
                      </div>
                    </td>

                    {/* Provider */}
                    <td className="px-4 py-3">
                      <span
                        className={clsx(
                          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border',
                          providerBadgeColor(cj.provider)
                        )}
                      >
                        {providerIcon(cj.provider)}
                        {providerLabel(cj.provider)}
                      </span>
                    </td>

                    {/* Schedule */}
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-gray-200 text-xs">{cronToHuman(cj.schedule)}</p>
                        <p className="text-gray-500 text-xs font-mono mt-0.5">{cj.schedule}</p>
                      </div>
                    </td>

                    {/* Namespace / Project */}
                    <td className="px-4 py-3 text-gray-300 text-xs">
                      {cj.provider === 'kubernetes' ? (
                        <span className="bg-gray-800 px-2 py-0.5 rounded text-gray-300">
                          {cj.namespace || 'default'}
                        </span>
                      ) : (
                        <span className="text-gray-300">{cj.projectName || '—'}</span>
                      )}
                    </td>

                    {/* Last Run */}
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {cj.lastRun ? formatRelativeTime(cj.lastRun) : '—'}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      {statusBadge(cj)}
                    </td>

                    {/* Active Jobs */}
                    <td className="px-4 py-3 text-gray-300 text-xs text-center">
                      {cj.activeJobs !== undefined && cj.activeJobs !== null
                        ? cj.activeJobs
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
