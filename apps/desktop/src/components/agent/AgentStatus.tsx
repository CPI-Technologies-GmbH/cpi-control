import { useAgentList, useRestartAgent, useUninstallAgent } from '@/hooks/useAgentStatus';
import { statusDotColor, statusBgColor, formatRelativeTime, formatDate } from '@/lib/formatters';
import { Server, RefreshCw, Trash2, Activity, Wifi, Clock, Hash, MapPin, Key, Copy, Check } from 'lucide-react';
import clsx from 'clsx';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { updates } from '@/lib/api';

// Map of ISO country codes to flag emojis
function countryFlag(code: string | null | undefined): string {
  if (!code || code.length !== 2) return '';
  const upper = code.toUpperCase();
  return String.fromCodePoint(
    ...upper.split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

function compareVersions(current: string, latest: string): 'latest' | 'minor' | 'major' {
  const [cMaj, cMin, cPatch] = current.split('.').map(Number);
  const [lMaj, lMin, lPatch] = latest.split('.').map(Number);
  if (cMaj === lMaj && cMin === lMin && cPatch >= lPatch) return 'latest';
  if (cMaj < lMaj) return 'major';
  return 'minor';
}

export default function AgentStatus() {
  const { data: agents, isLoading, error } = useAgentList();
  const restartMutation = useRestartAgent();
  const uninstallMutation = useUninstallAgent();
  const [confirmUninstallId, setConfirmUninstallId] = useState<string | null>(null);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  const { data: latestAgent } = useQuery({
    queryKey: ['updates', 'agent'],
    queryFn: () => updates.checkAgent(),
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  const latestAgentVersion = latestAgent?.assets
    ?.find((a: any) => a.name.includes('linux-amd64'))
    ?.name.match(/agent[_-]?(\d+\.\d+\.\d+)/)?.[1]
    ?? latestAgent?.latestVersion;

  const qc = useQueryClient();
  const pollMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`http://localhost:19876/api/agents/${id}/poll`, { method: 'POST' });
      if (!res.ok) throw new Error('Poll failed');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] });
    },
  });

  function copyPublicKey(agentId: string, key: string) {
    navigator.clipboard.writeText(key);
    setCopiedKeyId(agentId);
    setTimeout(() => setCopiedKeyId(null), 2000);
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="card p-4">
            <div className="skeleton w-full h-20 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return <div className="card p-6 text-center text-red-400">Failed to load agent status</div>;
  }

  if (!agents || agents.length === 0) {
    return (
      <div className="card p-8 text-center">
        <Server size={32} className="mx-auto text-gray-600 mb-3" />
        <p className="text-gray-400">No agents installed</p>
        <p className="text-sm text-gray-600 mt-1">
          Use the installer below to deploy a monitoring agent
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {agents.map((agent) => (
        <div key={agent.id} className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div
                className={clsx(
                  'w-2.5 h-2.5 rounded-full',
                  statusDotColor(agent.status)
                )}
              />
              <div>
                <h3 className="text-sm font-semibold text-gray-200">{agent.name}</h3>
                <p className="text-xs text-gray-500">
                  {agent.host}:{agent.port || 22} ({agent.username})
                </p>
              </div>
            </div>
            <span className={clsx('badge', statusBgColor(agent.status))}>
              {agent.status}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs mb-3">
            <div className="flex items-center gap-1.5">
              <Activity size={12} className="text-gray-500" />
              <div>
                <p className="text-gray-500">Version</p>
                <div className="flex items-center gap-1.5">
                  <p className="text-gray-300 font-mono">{agent.version || '—'}</p>
                  {agent.version && latestAgentVersion && (() => {
                    const status = compareVersions(agent.version, latestAgentVersion);
                    if (status === 'latest') return <span className="w-2 h-2 rounded-full bg-emerald-500" title="Up to date" />;
                    if (status === 'minor') return <span className="w-2 h-2 rounded-full bg-amber-500" title={`Update available: ${latestAgentVersion}`} />;
                    return <span className="w-2 h-2 rounded-full bg-red-500" title={`Major update: ${latestAgentVersion}`} />;
                  })()}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Wifi size={12} className="text-gray-500" />
              <div>
                <p className="text-gray-500">Last Heartbeat</p>
                <p className="text-gray-300">{formatRelativeTime(agent.lastHeartbeatAt)}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock size={12} className="text-gray-500" />
              <div>
                <p className="text-gray-500">Installed</p>
                <p className="text-gray-300">{formatDate(agent.installedAt)}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Hash size={12} className="text-gray-500" />
              <div>
                <p className="text-gray-500">ID</p>
                <p className="text-gray-300 font-mono truncate">{agent.id.slice(0, 12)}</p>
              </div>
            </div>
          </div>

          {/* Location & Public Key */}
          {(agent.locationCity || agent.locationCountry || agent.publicKey) && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs mb-3">
              {(agent.locationCity || agent.locationCountry) && (
                <div className="flex items-center gap-1.5">
                  <MapPin size={12} className="text-gray-500" />
                  <div>
                    <p className="text-gray-500">Location</p>
                    <p className="text-gray-300">
                      {[agent.locationCity, agent.locationCountry].filter(Boolean).join(', ')}
                      {agent.locationCountry && (
                        <span className="ml-1">{countryFlag(agent.locationCountry)}</span>
                      )}
                    </p>
                  </div>
                </div>
              )}
              {agent.publicKey && (
                <div className="flex items-center gap-1.5 col-span-2">
                  <Key size={12} className="text-gray-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-gray-500">Public Key</p>
                    <div className="flex items-center gap-1.5">
                      <p className="text-gray-300 font-mono truncate">
                        {agent.publicKey.slice(0, 24)}...
                      </p>
                      <button
                        onClick={() => copyPublicKey(agent.id, agent.publicKey!)}
                        className="text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
                        title="Copy public key"
                      >
                        {copiedKeyId === agent.id ? (
                          <Check size={12} className="text-emerald-400" />
                        ) : (
                          <Copy size={12} />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 pt-2 border-t border-gray-700/50">
            <button
              onClick={() => pollMutation.mutate(agent.id)}
              disabled={pollMutation.isPending}
              className="btn-ghost text-xs flex items-center gap-1.5 py-1"
            >
              <RefreshCw size={12} className={pollMutation.isPending ? 'animate-spin' : ''} />
              Status prüfen
            </button>
            <button
              onClick={() => restartMutation.mutate(agent.id)}
              disabled={restartMutation.isPending}
              className="btn-ghost text-xs flex items-center gap-1.5 py-1"
            >
              <RefreshCw size={12} className={restartMutation.isPending ? 'animate-spin' : ''} />
              Restart
            </button>
            {confirmUninstallId !== agent.id ? (
              <button
                onClick={() => setConfirmUninstallId(agent.id)}
                className="btn-ghost text-xs text-red-400 flex items-center gap-1.5 py-1"
              >
                <Trash2 size={12} />
                Uninstall
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    uninstallMutation.mutate(agent.id);
                    setConfirmUninstallId(null);
                  }}
                  disabled={uninstallMutation.isPending}
                  className="btn-danger text-xs py-1 px-3"
                >
                  Confirm Uninstall
                </button>
                <button
                  onClick={() => setConfirmUninstallId(null)}
                  className="btn-ghost text-xs py-1"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
