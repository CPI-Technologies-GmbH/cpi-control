import { Link } from 'react-router-dom';
import { ExternalLink, AlertCircle } from 'lucide-react';
import type { Service } from '@/types';
import { statusDotColor, statusBgColor, formatRelativeTime, formatMs } from '@/lib/formatters';
import clsx from 'clsx';

interface Props {
  service: Service;
}

export default function StatusCard({ service }: Props) {
  return (
    <Link to={`/services/${service.id}`} className="card-hover p-4 block group">
      {/* Top row: status dot + name */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={clsx(
              'w-2.5 h-2.5 rounded-full flex-shrink-0',
              statusDotColor(service.status)
            )}
          />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-100 truncate group-hover:text-blue-400 transition-colors">
              {service.name}
            </h3>
            <p className="text-xs text-gray-500 truncate">{service.customerName || '\u2014'}</p>
          </div>
        </div>
        <ExternalLink size={14} className="text-gray-600 group-hover:text-gray-400 flex-shrink-0 mt-0.5" />
      </div>

      {/* Badges row */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className={clsx('badge', statusBgColor(service.status))}>
          {service.status}
        </span>
        <span className="badge bg-gray-700/50 text-gray-400 border-gray-600/50">
          {service.environment}
        </span>
        <span className="badge bg-gray-700/50 text-gray-400 border-gray-600/50">
          {service.hostingType}
        </span>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-gray-500">Response</p>
          <p className="text-gray-300 font-medium">
            {formatMs(service.lastResponseTimeMs)}
          </p>
        </div>
        <div>
          <p className="text-gray-500">Last Check</p>
          <p className="text-gray-300 font-medium">
            {formatRelativeTime(service.lastCheckedAt)}
          </p>
        </div>
      </div>

      {/* Open incident badge */}
      {service.openIncidentCount && service.openIncidentCount > 0 && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-2 py-1">
          <AlertCircle size={12} />
          <span>
            {service.openIncidentCount} open incident{service.openIncidentCount > 1 ? 's' : ''}
          </span>
        </div>
      )}
    </Link>
  );
}

export function StatusCardSkeleton() {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="skeleton w-2.5 h-2.5 rounded-full" />
        <div className="space-y-1.5 flex-1">
          <div className="skeleton w-32 h-4 rounded" />
          <div className="skeleton w-20 h-3 rounded" />
        </div>
      </div>
      <div className="flex gap-2 mb-3">
        <div className="skeleton w-16 h-5 rounded-full" />
        <div className="skeleton w-16 h-5 rounded-full" />
        <div className="skeleton w-16 h-5 rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="skeleton w-16 h-8 rounded" />
        <div className="skeleton w-16 h-8 rounded" />
      </div>
    </div>
  );
}
