import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { projects as api } from '@/lib/api';
import ProjectForm from './ProjectForm';
import ProjectDashboard from './ProjectDashboard';
import ProjectServiceManager from './ProjectServiceManager';
import ProjectDeployments from './ProjectDeployments';
import { ArrowLeft, Edit2, Trash2, Mail, Phone, FileText, LayoutDashboard, Server, Rocket } from 'lucide-react';
import { formatDate } from '@/lib/formatters';
import type { Project } from '@/types';

type Tab = 'dashboard' | 'services' | 'deployments';

const tabs: Array<{ key: Tab; label: string; icon: React.ReactNode }> = [
  { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={14} /> },
  { key: 'services', label: 'Services', icon: <Server size={14} /> },
  { key: 'deployments', label: 'Deployments', icon: <Rocket size={14} /> },
];

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const qc = useQueryClient();

  const { data: project, isLoading, error } = useQuery({
    queryKey: ['projects', id],
    queryFn: () => api.get(id!),
    enabled: !!id,
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<Project>) => api.update(id!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects', id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      setEditing(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      window.history.back();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="skeleton w-48 h-8 rounded" />
        <div className="skeleton w-full h-32 rounded-lg" />
        <div className="skeleton w-full h-64 rounded-lg" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="card p-8 text-center">
        <p className="text-red-400 mb-4">
          {error ? 'Failed to load project' : 'Project not found'}
        </p>
        <Link to="/projects" className="btn-secondary text-sm">
          Back to Projects
        </Link>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="space-y-6">
        <Link to="/projects" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors">
          <ArrowLeft size={16} />
          Back to Projects
        </Link>
        <ProjectForm
          project={project}
          onSubmit={(data) => updateMutation.mutate(data)}
          onCancel={() => setEditing(false)}
          isSubmitting={updateMutation.isPending}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link to="/projects" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors">
        <ArrowLeft size={16} />
        Back to Projects
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100 mb-1">{project.name}</h1>
          <p className="text-sm text-gray-500">Created {formatDate(project.createdAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setEditing(true)} className="btn-secondary flex items-center gap-2 text-sm">
            <Edit2 size={14} />
            Edit
          </button>
          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)} className="btn-ghost text-sm text-red-400 hover:text-red-300">
              <Trash2 size={14} />
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="btn-danger text-sm"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Confirm Delete'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="btn-ghost text-sm"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Info card */}
      <div className="card p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="flex items-start gap-3">
            <Mail size={16} className="text-gray-500 mt-0.5" />
            <div>
              <p className="text-xs text-gray-500">Email</p>
              <p className="text-sm text-gray-200">{project.contactEmail || '—'}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Phone size={16} className="text-gray-500 mt-0.5" />
            <div>
              <p className="text-xs text-gray-500">Phone</p>
              <p className="text-sm text-gray-200">{project.contactPhone || '—'}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <FileText size={16} className="text-gray-500 mt-0.5" />
            <div>
              <p className="text-xs text-gray-500">Slug</p>
              <p className="text-sm text-gray-200 font-mono">{project.slug}</p>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500">Last Updated</p>
            <p className="text-sm text-gray-200">{formatDate(project.updatedAt)}</p>
          </div>
        </div>
        {project.notes && (
          <div className="mt-4 pt-4 border-t border-gray-700/50">
            <p className="text-xs text-gray-500 mb-1">Notes</p>
            <p className="text-sm text-gray-300 whitespace-pre-wrap">{project.notes}</p>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-6 border-b border-gray-800 pb-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={clsx(
              'flex items-center gap-1.5 pb-3 text-sm font-medium transition-colors',
              activeTab === tab.key ? 'tab-active' : 'tab-inactive'
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'dashboard' && <ProjectDashboard projectId={project.id} />}
      {activeTab === 'services' && <ProjectServiceManager project={project} />}
      {activeTab === 'deployments' && <ProjectDeployments projectId={project.id} />}
    </div>
  );
}
