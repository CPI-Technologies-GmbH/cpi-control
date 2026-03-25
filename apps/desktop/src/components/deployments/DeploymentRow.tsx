import type { DeploymentRecord } from '@/types';
import CIStatusBadge from './CIStatusBadge';
import { statusBgColor, formatRelativeTime, formatMs, truncate, providerColor, providerLabel } from '@/lib/formatters';
import { ProviderIcon } from '@/components/icons/ProviderIcons';
import { ExternalLink, GitBranch } from 'lucide-react';
import clsx from 'clsx';

interface Props {
  deployment: DeploymentRecord;
}

export default function DeploymentRow({ deployment }: Props) {
  const dep = deployment;

  return (
    <tr className="hover:bg-gray-800/30 transition-colors border-b border-gray-800/50">
      {/* Service */}
      <td className="px-4 py-3">
        <p className="text-sm font-medium text-gray-200">{dep.serviceName || '—'}</p>
        <p className="text-xs text-gray-500">{dep.projectName || ''}</p>
      </td>

      {/* Last Commit */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {dep.branch && (
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <GitBranch size={12} />
              {dep.branch}
            </span>
          )}
        </div>
        <p className="text-sm text-gray-300 truncate max-w-xs">
          {dep.commitMessage ? truncate(dep.commitMessage.split('\n')[0], 50) : '—'}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          {dep.commitSha && (
            <span className="text-xs text-gray-500 font-mono">{dep.commitSha.slice(0, 7)}</span>
          )}
          {dep.author && <span className="text-xs text-gray-500">by {dep.author}</span>}
        </div>
      </td>

      {/* CI Status */}
      <td className="px-4 py-3">
        <CIStatusBadge status={dep.status} />
      </td>

      {/* CI Duration */}
      <td className="px-4 py-3 text-xs text-gray-400 font-mono">
        {dep.buildDurationMs ? formatMs(dep.buildDurationMs) : '—'}
      </td>

      {/* Deployment */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={clsx('badge text-[10px] flex items-center gap-1', providerColor(dep.provider))}>
            <ProviderIcon provider={dep.provider} size={12} />
            {providerLabel(dep.provider)}
          </span>
          {dep.environment && (
            <span className="badge bg-gray-700/50 text-gray-400 border-gray-600/50 text-[10px]">
              {dep.environment}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">
          {formatRelativeTime(dep.startedAt)}
        </p>
      </td>

      {/* Link */}
      <td className="px-4 py-3">
        {dep.url ? (
          <a
            href={dep.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-500 hover:text-blue-400 transition-colors"
          >
            <ExternalLink size={14} />
          </a>
        ) : (
          <span className="text-gray-600">—</span>
        )}
      </td>

      {/* Correlations (placeholder) */}
      <td className="px-4 py-3">
        <span className="text-xs text-gray-600">—</span>
      </td>
    </tr>
  );
}
