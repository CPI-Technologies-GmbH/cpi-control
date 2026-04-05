import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Rocket, CheckCircle2, XCircle, AlertTriangle, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import { useNotificationStore, type Notification, type OpsEventType } from '@/hooks/useEventStream';
import clsx from 'clsx';

// ─── Toast Configuration ─────────────────────────────────────────────────────

const TOAST_DURATION = 5000;
const MAX_VISIBLE_TOASTS = 3;

interface EventConfig {
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
}

function getEventConfig(type: OpsEventType): EventConfig {
  switch (type) {
    case 'deployment.started':
      return {
        icon: <Rocket size={18} />,
        color: 'text-blue-400',
        bgColor: 'bg-blue-500/10',
        borderColor: 'border-blue-500/30',
        label: 'Deployment Started',
      };
    case 'deployment.completed':
      return {
        icon: <CheckCircle2 size={18} />,
        color: 'text-green-400',
        bgColor: 'bg-green-500/10',
        borderColor: 'border-green-500/30',
        label: 'Deployment Completed',
      };
    case 'deployment.failed':
      return {
        icon: <XCircle size={18} />,
        color: 'text-red-400',
        bgColor: 'bg-red-500/10',
        borderColor: 'border-red-500/30',
        label: 'Deployment Failed',
      };
    case 'service.down':
      return {
        icon: <ArrowDownCircle size={18} />,
        color: 'text-red-400',
        bgColor: 'bg-red-500/10',
        borderColor: 'border-red-500/30',
        label: 'Service Down',
      };
    case 'service.up':
      return {
        icon: <ArrowUpCircle size={18} />,
        color: 'text-green-400',
        bgColor: 'bg-green-500/10',
        borderColor: 'border-green-500/30',
        label: 'Service Recovered',
      };
    case 'service.degraded':
      return {
        icon: <AlertTriangle size={18} />,
        color: 'text-amber-400',
        bgColor: 'bg-amber-500/10',
        borderColor: 'border-amber-500/30',
        label: 'Service Degraded',
      };
  }
}

// ─── Single Toast ────────────────────────────────────────────────────────────

function Toast({ notification, onDismiss }: { notification: Notification; onDismiss: () => void }) {
  const navigate = useNavigate();
  const [isExiting, setIsExiting] = useState(false);
  const config = getEventConfig(notification.type);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsExiting(true);
      setTimeout(onDismiss, 300);
    }, TOAST_DURATION);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const handleClick = () => {
    if (notification.serviceId) {
      navigate(`/services/${notification.serviceId}`);
    } else if (notification.type.startsWith('deployment.')) {
      navigate('/deployments');
    }
    onDismiss();
  };

  const timeAgo = formatTimeAgo(notification.timestamp);

  return (
    <div
      className={clsx(
        'relative flex items-start gap-3 p-3 rounded-lg border backdrop-blur-md cursor-pointer',
        'shadow-lg shadow-black/30 transition-all duration-300',
        config.bgColor,
        config.borderColor,
        isExiting ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0',
        'hover:brightness-110'
      )}
      onClick={handleClick}
    >
      <div className={clsx('mt-0.5 shrink-0', config.color)}>{config.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={clsx('text-xs font-semibold uppercase tracking-wide', config.color)}>
            {config.label}
          </span>
          <span className="text-[10px] text-gray-500 shrink-0">{timeAgo}</span>
        </div>
        <p className="text-sm text-gray-200 mt-0.5 truncate">{notification.serviceName}</p>
        {typeof notification.details?.errorMessage === 'string' && (
          <p className="text-xs text-gray-400 mt-0.5 truncate">
            {notification.details.errorMessage}
          </p>
        )}
        {typeof notification.details?.commitMessage === 'string' && (
          <p className="text-xs text-gray-400 mt-0.5 truncate">
            {notification.details.commitMessage}
          </p>
        )}
      </div>
      <button
        className="shrink-0 p-0.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          setIsExiting(true);
          setTimeout(onDismiss, 300);
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ─── Toast Container ─────────────────────────────────────────────────────────

export default function NotificationToast() {
  const notifications = useNotificationStore((s) => s.notifications);
  const dismiss = useNotificationStore((s) => s.dismiss);

  const visibleToasts = notifications
    .filter((n) => !n.dismissed)
    .slice(0, MAX_VISIBLE_TOASTS);

  if (visibleToasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2 w-96 pointer-events-auto">
      {visibleToasts.map((notification) => (
        <Toast
          key={notification.id}
          notification={notification}
          onDismiss={() => dismiss(notification.id)}
        />
      ))}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTimeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
