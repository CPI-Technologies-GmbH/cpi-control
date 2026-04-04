import { useQuery } from '@tanstack/react-query';
import { updates } from '@/lib/api';
import type { UpdateInfo } from '@/lib/api';
import { Download, RefreshCw, Package, Server, CheckCircle } from 'lucide-react';
import clsx from 'clsx';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ReleaseCard({
  title,
  icon,
  data,
  isLoading,
  error,
  onRefresh,
  currentVersion,
}: {
  title: string;
  icon: React.ReactNode;
  data: UpdateInfo | undefined;
  isLoading: boolean;
  error: Error | null;
  onRefresh: () => void;
  currentVersion?: string;
}) {
  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {icon}
          <h2 className="text-lg font-semibold text-gray-100">{title}</h2>
        </div>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="btn-ghost py-1.5 text-sm flex items-center gap-1.5"
        >
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          Prüfen
        </button>
      </div>

      {currentVersion && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">Installierte Version:</span>
          <span className="font-mono text-gray-300 bg-gray-800 px-2 py-0.5 rounded">
            v{currentVersion}
          </span>
        </div>
      )}

      {error && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
          Update-Check fehlgeschlagen: {error.message}
        </div>
      )}

      {isLoading && !data && (
        <div className="space-y-3">
          <div className="skeleton w-full h-6 rounded" />
          <div className="skeleton w-3/4 h-4 rounded" />
          <div className="skeleton w-1/2 h-4 rounded" />
        </div>
      )}

      {data && (
        <>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle size={16} className="text-green-400" />
                <span className="text-sm font-medium text-gray-200">
                  {data.latestName}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {data.draft && (
                  <span className="badge bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">
                    Draft
                  </span>
                )}
                {data.prerelease && (
                  <span className="badge bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">
                    Pre-release
                  </span>
                )}
              </div>
            </div>

            <div className="text-xs text-gray-500">
              Veröffentlicht: {formatDate(data.publishedAt)}
            </div>

          </div>
        </>
      )}
    </div>
  );
}

export default function UpdateSettings() {
  const appUpdate = useQuery({
    queryKey: ['updates', 'app'],
    queryFn: () => updates.checkApp(),
    enabled: false,
    retry: false,
  });

  const agentUpdate = useQuery({
    queryKey: ['updates', 'agent'],
    queryFn: () => updates.checkAgent(),
    enabled: false,
    retry: false,
  });

  function handleAppUpdate() {
    const dmgAsset = appUpdate.data?.assets.find((a) => a.name.includes('aarch64') && a.name.endsWith('.dmg'))
      ?? appUpdate.data?.assets.find((a) => a.name.endsWith('.dmg'));
    const url = dmgAsset?.url ?? 'https://github.com/CPI-Technologies-GmbH/cpi-control/releases/tag/latest';
    window.open(url, '_blank');
  }

  function checkAll() {
    appUpdate.refetch();
    agentUpdate.refetch();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Download size={20} className="text-blue-400" />
          <h1 className="text-xl font-bold text-gray-100">Updates</h1>
        </div>
        <button
          onClick={checkAll}
          disabled={appUpdate.isFetching || agentUpdate.isFetching}
          className="btn-secondary text-sm flex items-center gap-2"
        >
          <RefreshCw
            size={14}
            className={clsx(
              (appUpdate.isFetching || agentUpdate.isFetching) && 'animate-spin'
            )}
          />
          Alle prüfen
        </button>
      </div>

      <ReleaseCard
        title="CPI-Control Desktop"
        icon={<Package size={18} className="text-purple-400" />}
        data={appUpdate.data}
        isLoading={appUpdate.isFetching}
        error={appUpdate.error}
        onRefresh={() => appUpdate.refetch()}
        currentVersion={appUpdate.data?.currentVersion}
      />

      {appUpdate.data && appUpdate.data.latestVersion && appUpdate.data.currentVersion && appUpdate.data.latestVersion !== appUpdate.data.currentVersion && (
        <button
          onClick={handleAppUpdate}
          className="btn-primary text-sm flex items-center gap-2"
        >
          <Download size={14} />
          Update herunterladen (v{appUpdate.data.latestVersion})
        </button>
      )}

      <ReleaseCard
        title="Monitoring Agent"
        icon={<Server size={18} className="text-green-400" />}
        data={agentUpdate.data}
        isLoading={agentUpdate.isFetching}
        error={agentUpdate.error}
        onRefresh={() => agentUpdate.refetch()}
      />
    </div>
  );
}
