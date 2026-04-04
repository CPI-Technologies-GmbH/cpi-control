import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projects as api } from '@/lib/api';
import ProjectForm from './ProjectForm';
import { FolderKanban, Plus, Search, Mail, Phone, ChevronRight } from 'lucide-react';
import { formatRelativeTime } from '@/lib/formatters';
import type { Project } from '@/types';

export default function ProjectList() {
  const [showForm, setShowForm] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [search, setSearch] = useState('');
  const qc = useQueryClient();

  const { data: projects, isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: api.list,
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<Project>) => api.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      setShowForm(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Project> }) => api.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      setEditingProject(null);
      setShowForm(false);
    },
  });

  const filtered = projects?.filter((c) =>
    search ? c.name.toLowerCase().includes(search.toLowerCase()) : true
  );

  function handleSubmit(data: Partial<Project>) {
    if (editingProject) {
      updateMutation.mutate({ id: editingProject.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FolderKanban size={20} className="text-blue-400" />
          <h1 className="text-xl font-bold text-gray-100">Projects</h1>
          {projects && (
            <span className="text-sm text-gray-500">({projects.length})</span>
          )}
        </div>
        <button
          onClick={() => {
            setEditingProject(null);
            setShowForm(true);
          }}
          className="btn-primary flex items-center gap-2 text-sm"
        >
          <Plus size={16} />
          New Project
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          placeholder="Search projects..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input pl-9 py-2 text-sm"
        />
      </div>

      {/* Form */}
      {showForm && (
        <ProjectForm
          project={editingProject}
          onSubmit={handleSubmit}
          onCancel={() => {
            setShowForm(false);
            setEditingProject(null);
          }}
          isSubmitting={createMutation.isPending || updateMutation.isPending}
        />
      )}

      {/* Error */}
      {error && (
        <div className="card p-6 text-center text-red-400">Failed to load projects</div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card p-4 flex items-center gap-4">
              <div className="skeleton w-10 h-10 rounded-lg" />
              <div className="space-y-1.5 flex-1">
                <div className="skeleton w-32 h-4 rounded" />
                <div className="skeleton w-20 h-3 rounded" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {filtered && filtered.length === 0 && !isLoading && (
        <div className="card p-12 text-center">
          <FolderKanban size={32} className="mx-auto text-gray-600 mb-3" />
          <p className="text-gray-400">No projects found</p>
          <p className="text-sm text-gray-600 mt-1">
            {search ? 'Try a different search term' : 'Create your first project to get started'}
          </p>
        </div>
      )}

      {/* List */}
      {filtered && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((project) => (
            <Link
              key={project.id}
              to={`/projects/${project.id}`}
              className="card-hover p-4 flex items-center justify-between group block"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-gray-700 flex items-center justify-center text-gray-300 font-semibold text-sm">
                  {project.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-200 group-hover:text-blue-400 transition-colors">
                    {project.name}
                  </h3>
                  <div className="flex items-center gap-3 mt-0.5">
                    {project.contactEmail && (
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Mail size={11} />
                        {project.contactEmail}
                      </span>
                    )}
                    {project.contactPhone && (
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Phone size={11} />
                        {project.contactPhone}
                      </span>
                    )}
                    <span className="text-xs text-gray-600">
                      Added {formatRelativeTime(project.createdAt)}
                    </span>
                  </div>
                  {project.healthSummary && project.serviceCount !== undefined && project.serviceCount > 0 && (
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex items-center gap-0.5">
                        {Array.from({ length: project.healthSummary.healthy }).map((_, i) => (
                          <span key={`h${i}`} className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        ))}
                        {Array.from({ length: project.healthSummary.degraded }).map((_, i) => (
                          <span key={`d${i}`} className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        ))}
                        {Array.from({ length: project.healthSummary.down }).map((_, i) => (
                          <span key={`x${i}`} className="w-1.5 h-1.5 rounded-full bg-red-500" />
                        ))}
                        {Array.from({ length: project.healthSummary.unknown }).map((_, i) => (
                          <span key={`u${i}`} className="w-1.5 h-1.5 rounded-full bg-gray-600" />
                        ))}
                      </div>
                      <span className="text-xs text-gray-500">{project.serviceCount} services</span>
                    </div>
                  )}
                </div>
              </div>
              <ChevronRight size={16} className="text-gray-600 group-hover:text-gray-400 transition-colors" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
