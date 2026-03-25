import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Rocket, CheckCircle2, XCircle, AlertTriangle, ArrowUpCircle, ArrowDownCircle, Trash2 } from 'lucide-react';
import { useNotificationStore, type OpsEventType } from '@/hooks/useEventStream';
import clsx from 'clsx';

function getEventIcon(type: OpsEventType) {
  switch (type) {
    case 'deployment.started':
      return <Rocket size={14} className="text-blue-400" />;
    case 'deployment.completed':
      return <CheckCircle2 size={14} className="text-green-400" />;
    case 'deployment.failed':
      return <XCircle size={14} className="text-red-400" />;
    case 'service.down':
      return <ArrowDownCircle size={14} className="text-red-400" />;
    case 'service.up':
      return <ArrowUpCircle size={14} className="text-green-400" />;
    case 'service.degraded':
      return <AlertTriangle size={14} className="text-amber-400" />;
  }
}

function getEventLabel(type: OpsEventType): string {
  switch (type) {
    case 'deployment.started': return 'Deployment Started';
    case 'deployment.completed': return 'Deployment Completed';
    case 'deployment.failed': return 'Deployment Failed';
    case 'service.down': return 'Service Down';
    case 'service.up': return 'Service Recovered';
    case 'service.degraded': return 'Service Degraded';
  }
}

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

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const notifications = useNotificationStore((s) => s.notifications);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const markRead = useNotificationStore((s) => s.markRead);
  const clearAll = useNotificationStore((s) => s.clearAll);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  const handleToggle = () => {
    if (!open && unreadCount > 0) {
      markAllRead();
    }
    setOpen((prev) => !prev);
  };

  const handleNotificationClick = (notification: typeof notifications[0]) => {
    markRead(notification.id);
    setOpen(false);
    if (notification.serviceId) {
      navigate(`/services/${notification.serviceId}`);
    } else if (notification.type.startsWith('deployment.')) {
      navigate('/deployments');
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        className="relative p-2 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
        onClick={handleToggle}
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 max-h-[480px] bg-gray-900 border border-gray-700/50 rounded-xl shadow-2xl shadow-black/50 overflow-hidden z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <h3 className="text-sm font-semibold text-gray-200">Notifications</h3>
            {notifications.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearAll();
                }}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                <Trash2 size={12} />
                Clear all
              </button>
            )}
          </div>

          {/* List */}
          <div className="overflow-y-auto max-h-[420px]">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                <Bell size={32} className="mb-2 opacity-30" />
                <p className="text-sm">No notifications yet</p>
              </div>
            ) : (
              notifications.slice(0, 50).map((notification) => (
                <button
                  key={notification.id}
                  className={clsx(
                    'w-full flex items-start gap-3 px-4 py-3 text-left transition-colors border-b border-gray-800/50 last:border-b-0',
                    notification.read
                      ? 'hover:bg-gray-800/30'
                      : 'bg-gray-800/20 hover:bg-gray-800/40'
                  )}
                  onClick={() => handleNotificationClick(notification)}
                >
                  <div className="mt-0.5 shrink-0">{getEventIcon(notification.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-gray-400">
                        {getEventLabel(notification.type)}
                      </span>
                      <span className="text-[10px] text-gray-600 shrink-0">
                        {formatTimeAgo(notification.timestamp)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-200 truncate">{notification.serviceName}</p>
                    {typeof notification.details?.commitMessage === 'string' && (
                      <p className="text-xs text-gray-500 truncate mt-0.5">
                        {notification.details.commitMessage}
                      </p>
                    )}
                  </div>
                  {!notification.read && (
                    <div className="shrink-0 mt-2 w-2 h-2 bg-blue-500 rounded-full" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
