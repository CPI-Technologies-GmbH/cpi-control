import { formatDistanceToNow, format, parseISO } from 'date-fns';
import type { ServiceStatus, IncidentSeverity, DeploymentStatus, DeploymentProvider } from '@/types';

export function formatDate(iso: string | null | undefined): string {
  if (!iso || iso === 'null') return '—';
  try {
    return format(parseISO(iso), 'MMM d, yyyy HH:mm');
  } catch {
    return iso;
  }
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso || iso === 'null') return 'Nie';
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
}

export function statusColor(status: ServiceStatus | string): string {
  switch (status) {
    case 'healthy':
    case 'up':
    case 'success':
    case 'online':
      return 'text-emerald-500';
    case 'degraded':
    case 'warning':
    case 'building':
    case 'deploying':
      return 'text-amber-500';
    case 'down':
    case 'critical':
    case 'failed':
    case 'error':
    case 'offline':
      return 'text-red-500';
    default:
      return 'text-gray-500';
  }
}

export function statusBgColor(status: ServiceStatus | string): string {
  switch (status) {
    case 'healthy':
    case 'up':
    case 'success':
    case 'online':
      return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    case 'degraded':
    case 'warning':
    case 'building':
    case 'deploying':
      return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    case 'down':
    case 'critical':
    case 'failed':
    case 'error':
    case 'offline':
      return 'bg-red-500/10 text-red-400 border-red-500/20';
    default:
      return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
  }
}

export function statusDotColor(status: ServiceStatus | string): string {
  switch (status) {
    case 'healthy':
    case 'up':
    case 'success':
    case 'online':
      return 'bg-emerald-500';
    case 'degraded':
    case 'warning':
    case 'building':
    case 'deploying':
      return 'bg-amber-500';
    case 'down':
    case 'critical':
    case 'failed':
    case 'error':
    case 'offline':
      return 'bg-red-500';
    default:
      return 'bg-gray-500';
  }
}

export function severityColor(severity: IncidentSeverity): string {
  switch (severity) {
    case 'critical':
      return 'bg-red-500/10 text-red-400 border-red-500/20';
    case 'warning':
      return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    case 'info':
      return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    default:
      return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
  }
}

export function deploymentStatusColor(status: DeploymentStatus): string {
  switch (status) {
    case 'pending':
      return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    case 'building':
    case 'deploying':
      return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    case 'success':
      return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    case 'failed':
      return 'bg-red-500/10 text-red-400 border-red-500/20';
    case 'cancelled':
      return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
    default:
      return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
  }
}

export function providerColor(provider: DeploymentProvider): string {
  switch (provider) {
    case 'github_actions':
      return 'bg-gray-500/10 text-gray-300 border-gray-500/30';
    case 'semaphore':
      return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    case 'vercel':
      return 'bg-white/10 text-gray-100 border-gray-400/30';
    case 'kubernetes':
      return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
    default:
      return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
  }
}

export function providerActiveColor(provider: DeploymentProvider): string {
  switch (provider) {
    case 'github_actions':
      return 'bg-gray-500/20 text-gray-200 border-gray-400/40';
    case 'semaphore':
      return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
    case 'vercel':
      return 'bg-white/15 text-white border-gray-300/50';
    case 'kubernetes':
      return 'bg-blue-500/20 text-blue-300 border-blue-500/40';
    default:
      return 'bg-gray-500/20 text-gray-300 border-gray-500/30';
  }
}

export function providerLabel(provider: DeploymentProvider): string {
  switch (provider) {
    case 'github_actions':
      return 'GitHub';
    case 'semaphore':
      return 'Semaphore';
    case 'vercel':
      return 'Vercel';
    case 'kubernetes':
      return 'Kubernetes';
    default:
      return provider;
  }
}

export function truncate(str: string, max: number = 50): string {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}
