import { Link } from 'react-router-dom';
import type { Service } from '@/types';
import { statusDotColor, statusBgColor, formatRelativeTime } from '@/lib/formatters';
import { ProviderIcon } from '@/components/icons/ProviderIcons';
import { AlertTriangle } from 'lucide-react';
import clsx from 'clsx';

interface Props {
  services: Service[];
}

export default function AlertSection({ services }: Props) {
  const alertServices = services.filter((s) => s.status === 'down' || s.status === 'degraded');

  if (alertServices.length === 0) return null;

  const downCount = alertServices.filter((s) => s.status === 'down').length;
  const degradedCount = alertServices.filter((s) => s.status === 'degraded').length;

  return (
    <div className="card border-red-500/20 bg-red-500/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} className="text-red-400" />
        <h2 className="text-sm font-semibold text-red-400">
          Attention Required
        </h2>
        <span className="text-xs text-gray-500 ml-auto">
          {downCount > 0 && `${downCount} down`}
          {downCount > 0 && degradedCount > 0 && ', '}
          {degradedCount > 0 && `${degradedCount} degraded`}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
        {alertServices.map((svc) => (
          <Link
            key={svc.id}
            to={`/services/${svc.id}`}
            className={clsx(
              'flex items-center gap-3 p-2.5 rounded-lg border transition-colors hover:bg-gray-800/50',
              svc.status === 'down'
                ? 'border-red-500/30 bg-red-500/5'
                : 'border-amber-500/30 bg-amber-500/5'
            )}
          >
            <div className={clsx('w-2 h-2 rounded-full flex-shrink-0', statusDotColor(svc.status))} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-200 truncate">{svc.name}</p>
              <p className="text-[10px] text-gray-500">{formatRelativeTime(svc.updatedAt)}</p>
            </div>
            <ProviderIcon provider={svc.hostingType as any} size={14} />
          </Link>
        ))}
      </div>
    </div>
  );
}
