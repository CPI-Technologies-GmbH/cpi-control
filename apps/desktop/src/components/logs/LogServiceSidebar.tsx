import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { projects as projectsApi } from '@/lib/api';
import type { Service, Project } from '@/types';
import { statusDotColor } from '@/lib/formatters';
import clsx from 'clsx';

interface Props {
  services: Service[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export default function LogServiceSidebar({ services, selectedIds, onChange }: Props) {
  const { data: projectsList = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
    staleTime: 60_000,
  });

  // Group services by project
  const grouped = useMemo(() => {
    const projectMap = new Map<string, Project>();
    for (const p of projectsList) {
      projectMap.set(p.id, p);
    }

    const groups: { project: Project | null; services: Service[] }[] = [];
    const byProject = new Map<string | null, Service[]>();

    for (const svc of services) {
      const key = svc.projectId || null;
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key)!.push(svc);
    }

    // Project groups first
    for (const [projectId, svcs] of byProject) {
      const project = projectId ? projectMap.get(projectId) || null : null;
      groups.push({ project, services: svcs.sort((a, b) => a.name.localeCompare(b.name)) });
    }

    // Sort: projects with names first, ungrouped last
    groups.sort((a, b) => {
      if (!a.project && b.project) return 1;
      if (a.project && !b.project) return -1;
      return (a.project?.name || '').localeCompare(b.project?.name || '');
    });

    return groups;
  }, [services, projectsList]);

  const selectedSet = new Set(selectedIds);

  function toggleService(id: string) {
    if (selectedSet.has(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  function toggleProject(projectServices: Service[]) {
    const ids = projectServices.map((s) => s.id);
    const allSelected = ids.every((id) => selectedSet.has(id));

    if (allSelected) {
      // Deselect all
      onChange(selectedIds.filter((id) => !ids.includes(id)));
    } else {
      // Select all
      const newIds = new Set(selectedIds);
      for (const id of ids) newIds.add(id);
      onChange(Array.from(newIds));
    }
  }

  return (
    <div className="w-56 flex-shrink-0 card overflow-y-auto max-h-full">
      <div className="p-3 border-b border-gray-800">
        <h3 className="text-xs text-gray-500 uppercase tracking-wide font-medium">Services</h3>
        <div className="flex items-center gap-2 mt-1.5">
          <button
            onClick={() => onChange(services.map((s) => s.id))}
            className="text-[10px] text-blue-400 hover:text-blue-300"
          >
            All
          </button>
          <span className="text-gray-700">|</span>
          <button
            onClick={() => onChange([])}
            className="text-[10px] text-gray-400 hover:text-gray-300"
          >
            None
          </button>
        </div>
      </div>

      <div className="p-2 space-y-3">
        {grouped.map(({ project, services: groupServices }, gi) => (
          <div key={project?.id || `ungrouped-${gi}`}>
            {/* Project header */}
            <button
              onClick={() => toggleProject(groupServices)}
              className="flex items-center gap-2 px-2 py-1 w-full text-left hover:bg-gray-800/50 rounded"
            >
              <input
                type="checkbox"
                readOnly
                checked={groupServices.every((s) => selectedSet.has(s.id))}
                className="rounded border-gray-600 text-blue-500 bg-gray-800 w-3 h-3"
              />
              <span className="text-xs font-medium text-gray-300 truncate">
                {project?.name || 'Unassigned'}
              </span>
              <span className="text-[10px] text-gray-600 ml-auto">{groupServices.length}</span>
            </button>

            {/* Services */}
            <div className="ml-2 mt-0.5 space-y-0">
              {groupServices.map((svc) => (
                <button
                  key={svc.id}
                  onClick={() => toggleService(svc.id)}
                  className="flex items-center gap-2 px-2 py-1 w-full text-left hover:bg-gray-800/50 rounded"
                >
                  <input
                    type="checkbox"
                    readOnly
                    checked={selectedSet.has(svc.id)}
                    className="rounded border-gray-600 text-blue-500 bg-gray-800 w-3 h-3"
                  />
                  <span
                    className={clsx(
                      'w-1.5 h-1.5 rounded-full flex-shrink-0',
                      statusDotColor(svc.status)
                    )}
                  />
                  <span className="text-xs text-gray-400 truncate">{svc.name}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
