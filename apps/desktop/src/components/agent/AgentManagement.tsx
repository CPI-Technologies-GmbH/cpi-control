import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import AgentStatus from './AgentStatus';
import AgentInstaller from './AgentInstaller';
import AgentConfig from './AgentConfig';
import { useAgentList } from '@/hooks/useAgentStatus';
import { updates } from '@/lib/api';
import { Server, RefreshCw, Download, CheckCircle, ArrowRight } from 'lucide-react';
import clsx from 'clsx';

function AgentUpdateCheck() {
  const { data: agents } = useAgentList();
  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ['updates', 'agent'],
    queryFn: () => updates.checkAgent(),
    enabled: false,
    retry: false,
  });

  const installedVersions = (agents ?? [])
    .filter((a) => a.version)
    .map((a) => ({ name: a.name, version: a.version! }));

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-200">Agent Update</h3>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="btn-ghost py-1.5 text-xs flex items-center gap-1.5"
        >
          <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
          Auf Updates prüfen
        </button>
      </div>

      {installedVersions.length > 0 && (
        <div className="space-y-1">
          {installedVersions.map((a) => (
            <div key={a.name} className="flex items-center gap-2 text-xs">
              <span className="text-gray-500">{a.name}:</span>
              <span className="font-mono text-gray-300 bg-gray-800 px-1.5 py-0.5 rounded">
                {a.version}
              </span>
              {data && (
                <>
                  <ArrowRight size={10} className="text-gray-600" />
                  <span className="font-mono text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">
                    {data.latestName}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded p-2">
          Check fehlgeschlagen: {(error as Error).message}
        </div>
      )}

      {data && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle size={14} className="text-green-400" />
            <span className="text-sm font-medium text-gray-200">{data.latestName}</span>
            {data.draft && (
              <span className="badge bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">
                Draft
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500">
            {new Date(data.publishedAt).toLocaleString('de-DE')}
          </div>
          {data.body && (
            <div className="text-xs text-gray-400 whitespace-pre-wrap border-t border-gray-700/50 pt-2">
              {data.body}
            </div>
          )}
          {data.assets.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {data.assets.map((a) => (
                <a
                  key={a.name}
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 bg-blue-500/10 px-2 py-0.5 rounded transition-colors"
                >
                  <Download size={10} />
                  {a.name}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AgentManagement() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Server size={20} className="text-blue-400" />
        <h1 className="text-xl font-bold text-gray-100">Agent Management</h1>
      </div>

      {/* Status */}
      <section>
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">
          Active Agents
        </h2>
        <AgentStatus />
      </section>

      {/* Update Check */}
      <section>
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">
          Updates
        </h2>
        <AgentUpdateCheck />
      </section>

      {/* Installer */}
      <section>
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">
          Deploy New Agent
        </h2>
        <AgentInstaller />
      </section>

      {/* Config */}
      <section>
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">
          Configuration
        </h2>
        <AgentConfig />
      </section>
    </div>
  );
}
