import type { ReactNode } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import UpdateBanner from './UpdateBanner';
import { useUIStore } from '@/stores/uiStore';
import { useEventStream } from '@/hooks/useEventStream';
import NotificationToast from '@/components/notifications/NotificationToast';
import clsx from 'clsx';

interface Props {
  children: ReactNode;
}

export default function MainLayout({ children }: Props) {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);

  // Connect to SSE event stream for push notifications
  useEventStream();

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950">
      <UpdateBanner />
      <Sidebar />
      <div
        className={clsx(
          'flex flex-1 flex-col overflow-hidden transition-all duration-300',
          sidebarOpen ? 'ml-64' : 'ml-16'
        )}
      >
        <Header />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
      <NotificationToast />
    </div>
  );
}
