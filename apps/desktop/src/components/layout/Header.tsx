import { useLocation, Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useMemo } from 'react';
import NotificationBell from '@/components/notifications/NotificationBell';

interface Breadcrumb {
  label: string;
  href?: string;
}

function useBreadcrumbs(): { title: string; breadcrumbs: Breadcrumb[] } {
  const location = useLocation();
  const segments = location.pathname.split('/').filter(Boolean);

  return useMemo(() => {
    if (segments.length === 0) {
      return { title: 'Dashboard', breadcrumbs: [{ label: 'Dashboard' }] };
    }

    const crumbs: Breadcrumb[] = [{ label: 'Dashboard', href: '/' }];
    let title = 'Dashboard';

    const routeMap: Record<string, string> = {
      customers: 'Customers',
      services: 'Services',
      deployments: 'Deployments',
      cronjobs: 'Cron Jobs',
      incidents: 'Incidents',
      logs: 'Logs',
      agent: 'Agent Management',
      settings: 'Settings',
    };

    if (segments[0] && routeMap[segments[0]]) {
      title = routeMap[segments[0]];
      if (segments.length === 1) {
        crumbs.push({ label: title });
      } else {
        crumbs.push({ label: title, href: `/${segments[0]}` });
        crumbs.push({ label: 'Detail' });
        title = `${title} Detail`;
      }
    }

    return { title, breadcrumbs: crumbs };
  }, [segments]);
}

export default function Header() {
  const { title, breadcrumbs } = useBreadcrumbs();

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-gray-800 bg-gray-950/80 backdrop-blur-md px-6">
      {/* Left: Breadcrumbs + Title */}
      <div>
        <nav className="flex items-center gap-1 text-xs text-gray-500">
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span>/</span>}
              {crumb.href ? (
                <Link to={crumb.href} className="hover:text-gray-300 transition-colors">
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-gray-400">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
        <h1 className="text-lg font-semibold text-gray-100">{title}</h1>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search..."
            className="input pl-9 py-1.5 text-sm w-64"
          />
        </div>
        <NotificationBell />
      </div>
    </header>
  );
}
