import { Link } from 'react-router-dom';
import type { Service, Project } from '@/types';
import { statusDotColor } from '@/lib/formatters';
import clsx from 'clsx';

interface Props {
  project: Project;
  services: Service[];
}

export default function ProjectCard({ project, services }: Props) {
  const statusCounts = {
    healthy: services.filter((s) => s.status === 'healthy').length,
    degraded: services.filter((s) => s.status === 'degraded').length,
    down: services.filter((s) => s.status === 'down').length,
    unknown: services.filter((s) => s.status === 'unknown').length,
  };

  const totalChecked = statusCounts.healthy + statusCounts.degraded + statusCounts.down;
  const uptimePercent = totalChecked > 0
    ? Math.round((statusCounts.healthy / totalChecked) * 100)
    : null;

  const hasIssues = statusCounts.down > 0 || statusCounts.degraded > 0;

  return (
    <Link
      to={`/projects/${project.id}`}
      className={clsx(
        'card p-4 hover:bg-gray-800/50 transition-colors border',
        hasIssues ? 'border-amber-500/20' : 'border-gray-800'
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-200">{project.name}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{services.length} services</p>
        </div>
        {uptimePercent !== null && (
          <span
            className={clsx(
              'text-xs font-mono font-medium',
              uptimePercent >= 99 ? 'text-emerald-400' :
              uptimePercent >= 95 ? 'text-amber-400' : 'text-red-400'
            )}
          >
            {uptimePercent}%
          </span>
        )}
      </div>

      {/* Status dots */}
      <div className="flex flex-wrap gap-1.5">
        {services.map((svc) => (
          <div
            key={svc.id}
            className={clsx('w-2.5 h-2.5 rounded-full', statusDotColor(svc.status))}
            title={`${svc.name}: ${svc.status}`}
          />
        ))}
      </div>

      {/* Status summary */}
      {hasIssues && (
        <div className="flex items-center gap-3 mt-3 text-[10px]">
          {statusCounts.down > 0 && (
            <span className="text-red-400">{statusCounts.down} down</span>
          )}
          {statusCounts.degraded > 0 && (
            <span className="text-amber-400">{statusCounts.degraded} degraded</span>
          )}
        </div>
      )}
    </Link>
  );
}
