import type { DeploymentRecord } from '@/types';
import { formatDate, formatMs, formatRelativeTime, providerColor, providerLabel, statusBgColor } from '@/lib/formatters';
import { ProviderIcon } from '@/components/icons/ProviderIcons';
import CIStatusBadge from './CIStatusBadge';
import { X, ExternalLink, GitBranch, GitCommit, Clock, User } from 'lucide-react';

interface Props {
  deployment: DeploymentRecord;
  onClose: () => void;
}

export default function DeploymentDetail({ deployment, onClose }: Props) {
  const dep = deployment;

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] bg-gray-900 border-l border-gray-800 z-50 flex flex-col shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        <div className="flex items-center gap-3 min-w-0">
          <ProviderIcon provider={dep.provider} size={20} />
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-gray-100 truncate">
              {dep.serviceName || dep.externalId || 'Deployment'}
            </h2>
            <p className="text-xs text-gray-500">{dep.projectName}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Status & Provider */}
        <div className="flex items-center gap-3">
          <CIStatusBadge status={dep.status} />
          <span className={`badge text-xs flex items-center gap-1 ${providerColor(dep.provider)}`}>
            <ProviderIcon provider={dep.provider} size={12} />
            {providerLabel(dep.provider)}
          </span>
          {dep.environment && (
            <span className="badge bg-gray-700/50 text-gray-400 border-gray-600/50 text-xs">
              {dep.environment}
            </span>
          )}
        </div>

        {/* Commit Info */}
        <div className="card p-4 space-y-3">
          <h3 className="text-xs text-gray-500 uppercase tracking-wide font-medium">Commit</h3>
          {dep.commitMessage && (
            <p className="text-sm text-gray-200">{dep.commitMessage}</p>
          )}
          <div className="flex flex-wrap gap-3 text-xs text-gray-400">
            {dep.branch && (
              <span className="flex items-center gap-1">
                <GitBranch size={12} className="text-gray-500" />
                {dep.branch}
              </span>
            )}
            {dep.commitSha && (
              <span className="flex items-center gap-1 font-mono">
                <GitCommit size={12} className="text-gray-500" />
                {dep.commitSha.slice(0, 7)}
              </span>
            )}
            {dep.author && (
              <span className="flex items-center gap-1">
                <User size={12} className="text-gray-500" />
                {dep.author}
              </span>
            )}
          </div>
        </div>

        {/* Timeline */}
        <div className="card p-4 space-y-3">
          <h3 className="text-xs text-gray-500 uppercase tracking-wide font-medium">Timeline</h3>
          <div className="space-y-2 text-xs">
            {dep.startedAt && (
              <div className="flex items-center justify-between">
                <span className="text-gray-400 flex items-center gap-1.5">
                  <Clock size={12} /> Started
                </span>
                <span className="text-gray-300">{formatDate(dep.startedAt)}</span>
              </div>
            )}
            {dep.completedAt && (
              <div className="flex items-center justify-between">
                <span className="text-gray-400 flex items-center gap-1.5">
                  <Clock size={12} /> Finished
                </span>
                <span className="text-gray-300">{formatDate(dep.completedAt)}</span>
              </div>
            )}
            {dep.buildDurationMs && (
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Duration</span>
                <span className="text-gray-300 font-mono">{formatMs(dep.buildDurationMs)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Metadata */}
        {dep.metadata && Object.keys(dep.metadata).length > 0 && (
          <div className="card p-4 space-y-3">
            <h3 className="text-xs text-gray-500 uppercase tracking-wide font-medium">Metadata</h3>
            <div className="space-y-1.5 text-xs">
              {Object.entries(dep.metadata).map(([key, value]) => (
                <div key={key} className="flex items-start justify-between gap-4">
                  <span className="text-gray-500 shrink-0">{key}</span>
                  <span className="text-gray-300 text-right truncate max-w-[240px] font-mono">
                    {typeof value === 'string' ? value : JSON.stringify(value) ?? ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error Details */}
        {dep.status === 'failed' && !!dep.metadata?.error && (
          <div className="card p-4 space-y-2 border-red-500/20">
            <h3 className="text-xs text-red-400 uppercase tracking-wide font-medium">Error</h3>
            <pre className="text-xs text-red-300/80 whitespace-pre-wrap font-mono bg-red-500/5 p-3 rounded-lg">
              {String(dep.metadata.error)}
            </pre>
          </div>
        )}
      </div>

      {/* Footer */}
      {dep.url && (
        <div className="p-4 border-t border-gray-800">
          <a
            href={dep.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary w-full flex items-center justify-center gap-2 py-2 text-sm"
          >
            <ExternalLink size={14} />
            View on {providerLabel(dep.provider)}
          </a>
        </div>
      )}
    </div>
  );
}
