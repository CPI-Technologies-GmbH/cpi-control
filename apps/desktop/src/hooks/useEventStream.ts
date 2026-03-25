import { useEffect, useRef, useCallback } from 'react';
import { create } from 'zustand';

const BASE_URL =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE_URL) ||
  'http://localhost:19876';

// ─── Types ───────────────────────────────────────────────────────────────────

export type OpsEventType =
  | 'deployment.started'
  | 'deployment.completed'
  | 'deployment.failed'
  | 'service.down'
  | 'service.up'
  | 'service.degraded';

export interface OpsEvent {
  id: string;
  type: OpsEventType;
  serviceName: string;
  serviceId?: string;
  provider: string;
  timestamp: string;
  details: Record<string, unknown>;
}

export interface Notification extends OpsEvent {
  read: boolean;
  dismissed: boolean;
}

// ─── Notification Store ──────────────────────────────────────────────────────

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (event: OpsEvent) => void;
  markAllRead: () => void;
  markRead: (id: string) => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
}

const MAX_NOTIFICATIONS = 100;

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,

  addNotification: (event: OpsEvent) => {
    const notification: Notification = {
      ...event,
      read: false,
      dismissed: false,
    };
    set((state) => {
      const updated = [notification, ...state.notifications].slice(0, MAX_NOTIFICATIONS);
      return {
        notifications: updated,
        unreadCount: updated.filter((n) => !n.read).length,
      };
    });
  },

  markAllRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    })),

  markRead: (id: string) =>
    set((state) => {
      const updated = state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      );
      return {
        notifications: updated,
        unreadCount: updated.filter((n) => !n.read).length,
      };
    }),

  dismiss: (id: string) =>
    set((state) => {
      const updated = state.notifications.map((n) =>
        n.id === id ? { ...n, dismissed: true, read: true } : n
      );
      return {
        notifications: updated,
        unreadCount: updated.filter((n) => !n.read).length,
      };
    }),

  clearAll: () => set({ notifications: [], unreadCount: 0 }),
}));

// ─── Browser Notification Permission ─────────────────────────────────────────

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function showBrowserNotification(event: OpsEvent) {
  if (
    'Notification' in window &&
    Notification.permission === 'granted' &&
    document.hidden
  ) {
    const titleMap: Record<OpsEventType, string> = {
      'deployment.started': 'Deployment Started',
      'deployment.completed': 'Deployment Completed',
      'deployment.failed': 'Deployment Failed',
      'service.down': 'Service Down',
      'service.up': 'Service Recovered',
      'service.degraded': 'Service Degraded',
    };

    const title = titleMap[event.type] || 'OpsBoard Event';
    const body = event.serviceName + (event.details?.errorMessage ? ` - ${event.details.errorMessage}` : '');
    const icon = event.type.startsWith('service.down')
      ? undefined
      : undefined;

    const notification = new Notification(title, {
      body,
      icon,
      tag: event.id,
      requireInteraction: event.type === 'service.down',
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }
}

// ─── SSE Hook ────────────────────────────────────────────────────────────────

export function useEventStream() {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addNotification = useNotificationStore((s) => s.addNotification);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`${BASE_URL}/api/events/stream`);
    eventSourceRef.current = es;

    const eventTypes: OpsEventType[] = [
      'deployment.started',
      'deployment.completed',
      'deployment.failed',
      'service.down',
      'service.up',
      'service.degraded',
    ];

    for (const eventType of eventTypes) {
      es.addEventListener(eventType, (e: MessageEvent) => {
        try {
          const event: OpsEvent = JSON.parse(e.data);
          addNotification(event);
          showBrowserNotification(event);
        } catch {
          // Ignore parse errors
        }
      });
    }

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      // Reconnect after 5 seconds
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(connect, 5000);
    };
  }, [addNotification]);

  useEffect(() => {
    requestNotificationPermission();
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [connect]);
}
