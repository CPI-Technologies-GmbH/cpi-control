import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { integrations as api } from '@/lib/api';
import { formatRelativeTime, statusBgColor } from '@/lib/formatters';
import { Plug, RefreshCw, ToggleLeft, ToggleRight, Loader2 } from 'lucide-react';
import clsx from 'clsx';

export default function IntegrationSettings() {
  const qc = useQueryClient();
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const { data: configs, isLoading, error } = useQuery({
    queryKey: ['integrations'],
    queryFn: api.list,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, any> }) =>
      api.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] });
    },
  });

  const syncMutation = useMutation({
    mutationFn: (id: string) => {
      setSyncingId(id);
      return api.sync(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] });
    },
    onSettled: () => {
      setSyncingId(null);
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-4">
            <div className="skeleton w-full h-16 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return <div className="card p-6 text-center text-red-400">Failed to load integrations</div>;
  }

  if (!configs || configs.length === 0) {
    return (
      <div className="card p-8 text-center">
        <Plug size={32} className="mx-auto text-gray-600 mb-3" />
        <p className="text-gray-400">No integrations configured</p>
        <p className="text-sm text-gray-600 mt-1">
          Integrations can be added via the API
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {configs.map((config) => (
        <div key={config.id} className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gray-700 flex items-center justify-center text-gray-300 text-xs font-bold uppercase">
                {config.provider.slice(0, 2)}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-200">{config.name}</h3>
                <p className="text-xs text-gray-500">{config.provider}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Sync button */}
              <button
                onClick={() => syncMutation.mutate(config.id)}
                disabled={syncingId === config.id}
                className="btn-ghost text-xs flex items-center gap-1.5 py-1"
              >
                <RefreshCw
                  size={12}
                  className={syncingId === config.id ? 'animate-spin' : ''}
                />
                Sync
              </button>

              {/* Toggle enabled */}
              <button
                onClick={() =>
                  updateMutation.mutate({
                    id: config.id,
                    data: { enabled: !config.enabled },
                  })
                }
                disabled={updateMutation.isPending}
                className="text-gray-400 hover:text-gray-200 transition-colors"
              >
                {config.enabled ? (
                  <ToggleRight size={24} className="text-emerald-400" />
                ) : (
                  <ToggleLeft size={24} className="text-gray-600" />
                )}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span>
              Sync interval: {config.syncIntervalSeconds ? `${config.syncIntervalSeconds}s` : '—'}
            </span>
            {config.lastSyncStatus && (
              <span className={clsx('badge text-[10px]', statusBgColor(config.lastSyncStatus))}>
                {config.lastSyncStatus}
              </span>
            )}
            {config.lastSyncAt && (
              <span>Last sync: {formatRelativeTime(config.lastSyncAt)}</span>
            )}
            {config.lastSyncError && (
              <span className="text-red-400 truncate max-w-xs">{config.lastSyncError}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
