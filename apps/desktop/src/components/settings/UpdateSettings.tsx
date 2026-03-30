import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { updates } from '@/lib/api';
import type { UpdateInfo } from '@/lib/api';
import { Download, RefreshCw, Package, Server, ExternalLink, CheckCircle } from 'lucide-react';
import clsx from 'clsx';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  const [expandAssets, setExpandAssets] = useState(false);

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

            {data.body && (
              <div className="text-sm text-gray-400 whitespace-pre-wrap border-t border-gray-700/50 pt-3">
                {data.body}
              </div>
            )}
          </div>

          {data.assets.length > 0 && (
            <div>
              <button
                onClick={() => setExpandAssets(!expandAssets)}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                {expandAssets ? 'Assets ausblenden' : `${data.assets.length} Assets anzeigen`}
              </button>

              {expandAssets && (
                <div className="mt-2 space-y-1">
                  {data.assets.map((asset) => (
                    <a
                      key={asset.name}
                      href={asset.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between px-3 py-2 rounded bg-gray-800/50 hover:bg-gray-800 transition-colors group"
                    >
                      <div className="flex items-center gap-2 text-sm text-gray-300">
                        <Download size={12} className="text-gray-500" />
                        <span className="font-mono text-xs">{asset.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">{formatBytes(asset.size)}</span>
                        <ExternalLink
                          size={12}
                          className="text-gray-600 group-hover:text-gray-400 transition-colors"
                        />
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
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

  const [installing, setInstalling] = useState(false);

  async function handleAppUpdate() {
    setInstalling(true);
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update) {
        await update.downloadAndInstall();
        const { relaunch } = await import('@tauri-apps/plugin-process');
        await relaunch();
      }
    } catch {
      // Not in Tauri context or update failed
    } finally {
      setInstalling(false);
    }
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
        currentVersion={appUpdate.data?.currentVersion ?? '0.1.0'}
      />

      {appUpdate.data && (
        <button
          onClick={handleAppUpdate}
          disabled={installing}
          className="btn-primary text-sm flex items-center gap-2"
        >
          <Download size={14} />
          {installing ? 'Installiert...' : 'Update & Neustart'}
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
