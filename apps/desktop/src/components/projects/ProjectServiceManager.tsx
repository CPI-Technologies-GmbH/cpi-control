import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useServices } from '@/hooks/useServices';
import { services as api } from '@/lib/api';
import ServiceList from '@/components/services/ServiceList';
import { statusDotColor } from '@/lib/formatters';
import { Edit2, Save, X, Search } from 'lucide-react';
import type { Project, Service } from '@/types';

export default function ProjectServiceManager({ project }: { project: Project }) {
  const [editMode, setEditMode] = useState(false);
  const [search, setSearch] = useState('');
  const [assignments, setAssignments] = useState<Map<string, boolean>>(new Map());
  const qc = useQueryClient();

  // Fetch all services only in edit mode
  const { data: allServices, isLoading } = useServices(editMode ? undefined : { projectId: project.id });

  const updateMutation = useMutation({
    mutationFn: async (changes: Array<{ id: string; projectId: string | null }>) => {
      await Promise.all(
        changes.map((c) => api.update(c.id, { projectId: c.projectId }))
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services'] });
      qc.invalidateQueries({ queryKey: ['projects', project.id, 'stats'] });
      setEditMode(false);
      setAssignments(new Map());
    },
  });

  const filteredServices = useMemo(() => {
    if (!editMode || !allServices) return [];
    if (!search) return allServices;
    const lower = search.toLowerCase();
    return allServices.filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        (s.url && s.url.toLowerCase().includes(lower))
    );
  }, [editMode, allServices, search]);

  const isAssigned = (service: Service): boolean => {
    if (assignments.has(service.id)) return assignments.get(service.id)!;
    return service.projectId === project.id;
  };

  const toggleAssignment = (serviceId: string, currentlyAssigned: boolean) => {
    setAssignments((prev) => {
      const next = new Map(prev);
      next.set(serviceId, !currentlyAssigned);
      return next;
    });
  };

  const handleSave = () => {
    if (!allServices) return;
    const changes: Array<{ id: string; projectId: string | null }> = [];

    for (const [serviceId, shouldBeAssigned] of assignments.entries()) {
      const svc = allServices.find((s) => s.id === serviceId);
      if (!svc) continue;
      const wasAssigned = svc.projectId === project.id;
      if (shouldBeAssigned && !wasAssigned) {
        changes.push({ id: serviceId, projectId: project.id });
      } else if (!shouldBeAssigned && wasAssigned) {
        changes.push({ id: serviceId, projectId: null });
      }
    }

    if (changes.length === 0) {
      setEditMode(false);
      setAssignments(new Map());
      return;
    }

    updateMutation.mutate(changes);
  };

  const handleCancel = () => {
    setEditMode(false);
    setAssignments(new Map());
    setSearch('');
  };

  const changeCount = useMemo(() => {
    if (!allServices) return 0;
    let count = 0;
    for (const [serviceId, shouldBeAssigned] of assignments.entries()) {
      const svc = allServices.find((s) => s.id === serviceId);
      if (!svc) continue;
      const wasAssigned = svc.projectId === project.id;
      if (shouldBeAssigned !== wasAssigned) count++;
    }
    return count;
  }, [assignments, allServices, project.id]);

  if (!editMode) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-200">Services</h2>
          <button
            onClick={() => setEditMode(true)}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <Edit2 size={14} />
            Edit Assignments
          </button>
        </div>
        <ServiceList projectId={project.id} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-200">Edit Service Assignments</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCancel}
            className="btn-ghost flex items-center gap-2 text-sm"
          >
            <X size={14} />
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <Save size={14} />
            {updateMutation.isPending ? 'Saving...' : `Save${changeCount > 0 ? ` (${changeCount})` : ''}`}
          </button>
        </div>
      </div>

      {/* Search + Select All */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search services..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-10 w-full"
          />
        </div>
        <button
          onClick={() => {
            const next = new Map(assignments);
            for (const svc of filteredServices) {
              next.set(svc.id, true);
            }
            setAssignments(next);
          }}
          className="btn-ghost text-xs whitespace-nowrap"
        >
          Select All
        </button>
        <button
          onClick={() => {
            const next = new Map(assignments);
            for (const svc of filteredServices) {
              next.set(svc.id, false);
            }
            setAssignments(next);
          }}
          className="btn-ghost text-xs whitespace-nowrap"
        >
          Deselect All
        </button>
      </div>

      {/* Service table */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="skeleton h-12 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left p-3 text-xs text-gray-500 font-medium w-10" />
                <th className="text-left p-3 text-xs text-gray-500 font-medium">Status</th>
                <th className="text-left p-3 text-xs text-gray-500 font-medium">Service</th>
                <th className="text-left p-3 text-xs text-gray-500 font-medium">Current Project</th>
                <th className="text-left p-3 text-xs text-gray-500 font-medium">Environment</th>
              </tr>
            </thead>
            <tbody>
              {filteredServices.map((svc) => {
                const assigned = isAssigned(svc);
                const wasAssigned = svc.projectId === project.id;
                const changed = assignments.has(svc.id) && assigned !== wasAssigned;

                return (
                  <tr
                    key={svc.id}
                    onClick={() => toggleAssignment(svc.id, assigned)}
                    className={clsx(
                      'border-b border-gray-800/50 cursor-pointer transition-colors',
                      changed
                        ? 'bg-blue-500/5'
                        : 'hover:bg-gray-800/50'
                    )}
                  >
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={assigned}
                        onChange={() => toggleAssignment(svc.id, assigned)}
                        className="accent-blue-500"
                      />
                    </td>
                    <td className="p-3">
                      <div className={clsx('w-2.5 h-2.5 rounded-full', statusDotColor(svc.status))} />
                    </td>
                    <td className="p-3">
                      <span className="text-gray-200">{svc.name}</span>
                    </td>
                    <td className="p-3">
                      {svc.projectId === project.id ? (
                        <span className="text-blue-400 text-xs">(this project)</span>
                      ) : svc.projectId ? (
                        <span className="text-gray-400 text-xs">{svc.projectName || 'Other'}</span>
                      ) : (
                        <span className="text-gray-600 text-xs">Unassigned</span>
                      )}
                    </td>
                    <td className="p-3">
                      <span className="badge bg-gray-700/50 text-gray-400 border-gray-600/50 text-xs">
                        {svc.environment}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {filteredServices.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-gray-500 text-sm">
                    {search ? 'No services match your search' : 'No services found'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
