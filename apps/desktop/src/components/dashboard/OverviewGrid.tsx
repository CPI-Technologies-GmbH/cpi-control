import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServices } from '@/hooks/useServices';
import { projects as projectsApi } from '@/lib/api';
import MetricsSummary from './MetricsSummary';
import AlertSection from './AlertSection';
import ProjectCard from './ProjectCard';
import DashboardIncidentList from './IncidentList';
import type { Service, Project } from '@/types';

export default function OverviewGrid() {
  const { data: services = [], isLoading, error } = useServices();
  const { data: projectsList = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
    staleTime: 60_000,
  });

  // Group services by project
  const projectGroups = useMemo(() => {
    const projectMap = new Map<string, Project>();
    for (const p of projectsList) {
      projectMap.set(p.id, p);
    }

    const groups: { project: Project; services: Service[] }[] = [];
    const byProject = new Map<string, Service[]>();

    for (const svc of services) {
      const projectId = svc.projectId;
      if (!projectId) continue;
      if (!byProject.has(projectId)) byProject.set(projectId, []);
      byProject.get(projectId)!.push(svc);
    }

    for (const [projectId, svcs] of byProject) {
      const project = projectMap.get(projectId);
      if (project) {
        groups.push({ project, services: svcs });
      }
    }

    // Sort: projects with issues first, then alphabetically
    groups.sort((a, b) => {
      const aIssues = a.services.filter((s) => s.status === 'down' || s.status === 'degraded').length;
      const bIssues = b.services.filter((s) => s.status === 'down' || s.status === 'degraded').length;
      if (aIssues !== bIssues) return bIssues - aIssues;
      return a.project.name.localeCompare(b.project.name);
    });

    return groups;
  }, [services, projectsList]);

  return (
    <div className="space-y-6">
      {/* Metrics bar */}
      <MetricsSummary />

      {/* Alert Section — services needing attention */}
      <AlertSection services={services} />

      {/* Main grid + sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Project Cards */}
        <div className="lg:col-span-3">
          {error && (
            <div className="card p-8 text-center text-red-400">
              Failed to load services. Please check the backend connection.
            </div>
          )}

          {isLoading && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="card p-4">
                  <div className="skeleton w-32 h-5 rounded mb-2" />
                  <div className="skeleton w-20 h-3 rounded mb-3" />
                  <div className="flex gap-1.5">
                    {Array.from({ length: 4 }).map((_, j) => (
                      <div key={j} className="skeleton w-2.5 h-2.5 rounded-full" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isLoading && projectGroups.length === 0 && services.length === 0 && (
            <div className="card p-12 text-center">
              <p className="text-gray-400 mb-2">No projects found</p>
              <p className="text-sm text-gray-600">
                Add integrations in Settings to auto-discover services
              </p>
            </div>
          )}

          {projectGroups.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {projectGroups.map(({ project, services: svcs }) => (
                <ProjectCard key={project.id} project={project} services={svcs} />
              ))}
            </div>
          )}
        </div>

        {/* Sidebar: Recent Activity */}
        <div className="lg:col-span-1">
          <DashboardIncidentList />
        </div>
      </div>
    </div>
  );
}
