import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useServices, useBatchUpdateServices, useDeleteService } from '@/hooks/useServices';
import { statusDotColor, formatRelativeTime, formatMs } from '@/lib/formatters';
import { ProviderIcon } from '@/components/icons/ProviderIcons';
import { Search, ExternalLink, Globe, Lock, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import type { ServiceFilters, ServiceType, Environment } from '@/types';

const typeOptions: { value: ServiceType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'website', label: 'Public' },
  { value: 'service', label: 'Private' },
];

const environmentOptions: Environment[] = ['production', 'staging', 'development'];
const batchTypeOptions: { value: ServiceType; label: string }[] = [
  { value: 'website', label: 'Public' },
  { value: 'service', label: 'Private' },
];

export default function ServiceList({ customerId }: { customerId?: string }) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<ServiceType | 'all'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchUpdating, setBatchUpdating] = useState(false);

  const filters: ServiceFilters = {
    ...(customerId && { customerId }),
    ...(search && { search }),
    ...(typeFilter !== 'all' && { type: typeFilter }),
  };

  const { data: services, isLoading, error } = useServices(filters);
  const batchUpdate = useBatchUpdateServices();
  const deleteService = useDeleteService();

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (!services) return;
    setSelectedIds((prev) => {
      if (prev.size === services.length) {
        return new Set();
      }
      return new Set(services.map((s) => s.id));
    });
  }, [services]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleBatchEnvironment = useCallback(async (env: Environment) => {
    setBatchUpdating(true);
    try {
      await batchUpdate.mutateAsync({
        ids: Array.from(selectedIds),
        updates: { environment: env },
      });
      clearSelection();
    } finally {
      setBatchUpdating(false);
    }
  }, [selectedIds, batchUpdate, clearSelection]);

  const handleBatchType = useCallback(async (type: ServiceType) => {
    setBatchUpdating(true);
    try {
      await batchUpdate.mutateAsync({
        ids: Array.from(selectedIds),
        updates: { type },
      });
      clearSelection();
    } finally {
      setBatchUpdating(false);
    }
  }, [selectedIds, batchUpdate, clearSelection]);

  const handleBatchDelete = useCallback(async () => {
    if (!window.confirm(`Delete ${selectedIds.size} selected service(s)? This cannot be undone.`)) {
      return;
    }
    setBatchUpdating(true);
    try {
      const promises = Array.from(selectedIds).map((id) =>
        deleteService.mutateAsync(id)
      );
      await Promise.all(promises);
      clearSelection();
    } finally {
      setBatchUpdating(false);
    }
  }, [selectedIds, deleteService, clearSelection]);

  const isAllSelected = services && services.length > 0 && selectedIds.size === services.length;
  const hasSelection = selectedIds.size > 0;

  return (
    <div className="space-y-4">
      {/* Search bar + type filter */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search services..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-9 py-2 text-sm w-full max-w-md"
          />
        </div>
        <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-0.5">
          {typeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setTypeFilter(opt.value)}
              className={clsx(
                'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                typeFilter === opt.value
                  ? 'bg-gray-700 text-gray-200'
                  : 'text-gray-500 hover:text-gray-300'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Batch action bar */}
      {hasSelection && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-blue-500/10 border border-blue-500/20 rounded-lg">
          <span className="text-sm text-blue-400 font-medium">
            {selectedIds.size} selected
          </span>
          <div className="h-4 w-px bg-gray-700" />

          {/* Change Environment dropdown */}
          <div className="relative">
            <select
              disabled={batchUpdating}
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  handleBatchEnvironment(e.target.value as Environment);
                  e.target.value = '';
                }
              }}
              className="input py-1 px-2 text-xs pr-6 appearance-none bg-gray-800 border-gray-700 text-gray-300 cursor-pointer disabled:opacity-50"
            >
              <option value="" disabled>Change Environment</option>
              {environmentOptions.map((env) => (
                <option key={env} value={env}>{env}</option>
              ))}
            </select>
          </div>

          {/* Change Type dropdown */}
          <div className="relative">
            <select
              disabled={batchUpdating}
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  handleBatchType(e.target.value as ServiceType);
                  e.target.value = '';
                }
              }}
              className="input py-1 px-2 text-xs pr-6 appearance-none bg-gray-800 border-gray-700 text-gray-300 cursor-pointer disabled:opacity-50"
            >
              <option value="" disabled>Change Type</option>
              {batchTypeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Delete Selected */}
          <button
            onClick={handleBatchDelete}
            disabled={batchUpdating}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50"
          >
            <Trash2 size={12} />
            Delete Selected
          </button>

          <div className="flex-1" />

          {/* Clear selection */}
          <button
            onClick={clearSelection}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            <X size={14} />
          </button>

          {batchUpdating && (
            <span className="text-xs text-gray-500">Updating...</span>
          )}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="card p-6 text-center text-red-400">Failed to load services</div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card p-4 flex items-center gap-4">
              <div className="skeleton w-3 h-3 rounded-full" />
              <div className="skeleton w-32 h-4 rounded" />
              <div className="skeleton w-20 h-4 rounded" />
              <div className="flex-1" />
              <div className="skeleton w-16 h-4 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {services && services.length === 0 && !isLoading && (
        <div className="card p-12 text-center">
          <Globe size={32} className="mx-auto text-gray-600 mb-3" />
          <p className="text-gray-400">No services found</p>
        </div>
      )}

      {/* Service table */}
      {services && services.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/50 text-left">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={isAllSelected || false}
                    onChange={toggleSelectAll}
                    className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500/30 focus:ring-offset-0 cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3 text-xs text-gray-500 uppercase tracking-wide font-medium">
                  Status
                </th>
                <th className="px-4 py-3 text-xs text-gray-500 uppercase tracking-wide font-medium">
                  Service
                </th>
                <th className="px-4 py-3 text-xs text-gray-500 uppercase tracking-wide font-medium">
                  Type
                </th>
                <th className="px-4 py-3 text-xs text-gray-500 uppercase tracking-wide font-medium">
                  Customer
                </th>
                <th className="px-4 py-3 text-xs text-gray-500 uppercase tracking-wide font-medium">
                  Environment
                </th>
                <th className="px-4 py-3 text-xs text-gray-500 uppercase tracking-wide font-medium">
                  Hosting
                </th>
                <th className="px-4 py-3 text-xs text-gray-500 uppercase tracking-wide font-medium">
                  Response
                </th>
                <th className="px-4 py-3 text-xs text-gray-500 uppercase tracking-wide font-medium">
                  Last Check
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {services.map((s) => (
                <tr
                  key={s.id}
                  className={clsx(
                    'hover:bg-gray-800/30 transition-colors',
                    selectedIds.has(s.id) && 'bg-blue-500/5'
                  )}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(s.id)}
                      onChange={() => toggleSelect(s.id)}
                      className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500/30 focus:ring-offset-0 cursor-pointer"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={clsx(
                        'inline-block w-2.5 h-2.5 rounded-full',
                        statusDotColor(s.status)
                      )}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/services/${s.id}`}
                      className="text-gray-200 hover:text-blue-400 font-medium transition-colors"
                    >
                      {s.name}
                    </Link>
                    {s.type === 'website' && s.url && (
                      <p className="text-xs text-gray-500 truncate max-w-xs">{s.url}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={clsx(
                      'badge text-[10px]',
                      s.type === 'website'
                        ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                        : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                    )}>
                      {s.type === 'website' ? (
                        <span className="flex items-center gap-1"><Globe size={10} /> Public</span>
                      ) : (
                        <span className="flex items-center gap-1"><Lock size={10} /> Private</span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{s.customerName || '\u2014'}</td>
                  <td className="px-4 py-3">
                    <span className="badge bg-gray-700/50 text-gray-400 border-gray-600/50">
                      {s.environment}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    <span className="flex items-center gap-1.5">
                      <ProviderIcon provider={s.hostingType} size={14} />
                      {s.hostingType}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-300 font-mono text-xs">
                    {formatMs(s.lastResponseTimeMs)}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {formatRelativeTime(s.lastCheckedAt)}
                  </td>
                  <td className="px-4 py-3">
                    {s.type === 'website' && s.url ? (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-600 hover:text-gray-400 transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink size={14} />
                      </a>
                    ) : (
                      <span className="text-gray-700">{'\u2014'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
