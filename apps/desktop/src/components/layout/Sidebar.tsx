import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderKanban,
  Layers,
  Rocket,
  Clock,
  AlertTriangle,
  ScrollText,
  Globe,
  Server,
  Settings,
  ChevronLeft,
  ChevronRight,
  Activity,
} from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import clsx from 'clsx';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Projects', href: '/projects', icon: FolderKanban },
  { name: 'Services', href: '/services', icon: Layers },
  { name: 'Deployments', href: '/deployments', icon: Rocket },
  { name: 'Cron Jobs', href: '/cronjobs', icon: Clock },
  { name: 'Incidents', href: '/incidents', icon: AlertTriangle },
  { name: 'Logs', href: '/logs', icon: ScrollText },
  { name: 'Status Pages', href: '/statuspages', icon: Globe },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export default function Sidebar() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  return (
    <aside
      className={clsx(
        'fixed inset-y-0 left-0 z-50 flex flex-col bg-gray-900 border-r border-gray-800 transition-all duration-300',
        sidebarOpen ? 'w-64' : 'w-16'
      )}
    >
      {/* Logo / Brand */}
      <div className="flex h-16 items-center justify-between px-4 border-b border-gray-800">
        {sidebarOpen && (
          <div className="flex items-center gap-2">
            <img src="/app-icon.png" alt="CPI-Control" className="h-6 w-6 rounded" />
            <span className="text-lg font-bold text-gray-100">CPI-Control</span>
          </div>
        )}
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
        >
          {sidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 space-y-1 px-2">
        {navigation.map((item) => (
          <NavLink
            key={item.href}
            to={item.href}
            end={item.href === '/'}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150',
                isActive
                  ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800 border border-transparent'
              )
            }
          >
            <item.icon size={20} className="flex-shrink-0" />
            {sidebarOpen && <span>{item.name}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      {sidebarOpen && (
        <div className="border-t border-gray-800 p-4">
          <p className="text-xs text-gray-600">CPI-Control v0.1.0</p>
        </div>
      )}
    </aside>
  );
}
