import { useServiceHealth } from '@/hooks/useServices';
import { statusDotColor, formatDate } from '@/lib/formatters';
import clsx from 'clsx';
import type { HealthCheckResult } from '@/types';

interface Props {
  serviceId: string;
}

export default function HealthTimeline({ serviceId }: Props) {
  const { data: checks, isLoading, error } = useServiceHealth(serviceId, { limit: 50 });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-3">
            <div className="skeleton w-3 h-3 rounded-full" />
            <div className="skeleton w-32 h-4 rounded" />
            <div className="skeleton w-16 h-4 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return <div className="p-4 text-sm text-red-400">Failed to load health timeline</div>;
  }

  if (!checks || checks.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-gray-500">
        No health check data available yet
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="absolute left-[17px] top-3 bottom-3 w-px bg-gray-800" />
      <div className="space-y-0">
        {checks.map((check: HealthCheckResult) => (
          <div
            key={check.id}
            className="flex items-start gap-4 p-3 hover:bg-gray-800/20 rounded-lg transition-colors relative"
          >
            <div
              className={clsx(
                'w-3.5 h-3.5 rounded-full border-2 border-gray-900 flex-shrink-0 mt-0.5 z-10',
                statusDotColor(check.status)
              )}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <span
                  className={clsx(
                    'text-sm font-medium',
                    check.status === 'healthy'
                      ? 'text-emerald-400'
                      : check.status === 'degraded'
                        ? 'text-amber-400'
                        : check.status === 'down'
                          ? 'text-red-400'
                          : 'text-gray-400'
                  )}
                >
                  {check.status.toUpperCase()}
                </span>
                {check.statusCode && (
                  <span className="text-xs text-gray-500">HTTP {check.statusCode}</span>
                )}
                {check.responseTimeMs !== null && check.responseTimeMs !== undefined && (
                  <span className="text-xs text-gray-500 font-mono">
                    {check.responseTimeMs}ms
                  </span>
                )}
              </div>
              {check.errorMessage && (
                <p className="text-xs text-red-400/80 mt-0.5 truncate">{check.errorMessage}</p>
              )}
              <p className="text-xs text-gray-600 mt-0.5">{formatDate(check.checkedAt)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
