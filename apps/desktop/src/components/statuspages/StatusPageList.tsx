import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { statusPages as api, agent as agentApi } from '@/lib/api';
import type { StatusPage, RemoteAgent } from '@/types';
import StatusPageForm from './StatusPageForm';
import {
  Globe,
  Plus,
  Pencil,
  Trash2,
  Upload,
  CheckCircle2,
  XCircle,
  Loader2,
  Server,
} from 'lucide-react';
import clsx from 'clsx';

export default function StatusPageList() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingPage, setEditingPage] = useState<StatusPage | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data: pages, isLoading } = useQuery({
    queryKey: ['statuspages'],
    queryFn: api.list,
  });

  const { data: agents } = useQuery({
    queryKey: ['agent', 'list'],
    queryFn: agentApi.list,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['statuspages'] });
      setConfirmDeleteId(null);
    },
  });

  const deployMutation = useMutation({
    mutationFn: (id: string) => api.deploy(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['statuspages'] });
    },
  });

  const agentMap = new Map<string, RemoteAgent>(
    (agents || []).map((a) => [a.id, a])
  );

  const themeLabels: Record<string, string> = {
    dark: 'Dark',
    light: 'Light',
    minimal: 'Minimal',
  };

  function handleEdit(page: StatusPage) {
    setEditingPage(page);
    setShowForm(true);
  }

  function handleCreate() {
    setEditingPage(null);
    setShowForm(true);
  }

  function handleFormClose() {
    setShowForm(false);
    setEditingPage(null);
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-100">Status Pages</h1>
        </div>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-4">
              <div className="skeleton w-full h-16 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Status Pages</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage public status pages deployed to your agents
          </p>
        </div>
        <button onClick={handleCreate} className="btn-primary flex items-center gap-2">
          <Plus size={16} />
          New Status Page
        </button>
      </div>

      {/* Form Modal */}
      {showForm && (
        <StatusPageForm
          page={editingPage}
          agents={agents || []}
          onClose={handleFormClose}
        />
      )}

      {/* List */}
      {(!pages || pages.length === 0) ? (
        <div className="card p-8 text-center">
          <Globe size={32} className="mx-auto text-gray-600 mb-3" />
          <p className="text-gray-400">No status pages yet</p>
          <p className="text-sm text-gray-600 mt-1">
            Create a status page to display service health publicly
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {pages.map((page) => {
            const agent = agentMap.get(page.agentId);
            return (
              <div key={page.id} className="card p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className={clsx(
                      'flex items-center justify-center w-10 h-10 rounded-lg',
                      page.isActive
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'bg-gray-700/50 text-gray-500'
                    )}>
                      <Globe size={20} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-gray-200 truncate">
                          {page.name}
                        </h3>
                        <span className={clsx(
                          'badge text-[10px]',
                          page.isActive
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : 'bg-gray-700/50 text-gray-500 border-gray-600'
                        )}>
                          {page.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                        <span className="font-mono">{page.domain}</span>
                        <span className="text-gray-700">|</span>
                        <span>Theme: {themeLabels[page.theme] || page.theme}</span>
                        {agent && (
                          <>
                            <span className="text-gray-700">|</span>
                            <span className="flex items-center gap-1">
                              <Server size={10} />
                              {agent.name}
                            </span>
                          </>
                        )}
                        {page.brandingCompany && (
                          <>
                            <span className="text-gray-700">|</span>
                            <span>{page.brandingCompany}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    <button
                      onClick={() => deployMutation.mutate(page.id)}
                      disabled={deployMutation.isPending}
                      className="btn-ghost text-xs flex items-center gap-1.5 py-1"
                      title="Deploy to agent"
                    >
                      {deployMutation.isPending ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Upload size={12} />
                      )}
                      Deploy
                    </button>
                    <button
                      onClick={() => handleEdit(page)}
                      className="btn-ghost text-xs flex items-center gap-1.5 py-1"
                    >
                      <Pencil size={12} />
                      Edit
                    </button>
                    {confirmDeleteId !== page.id ? (
                      <button
                        onClick={() => setConfirmDeleteId(page.id)}
                        className="btn-ghost text-xs text-red-400 flex items-center gap-1.5 py-1"
                      >
                        <Trash2 size={12} />
                      </button>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => deleteMutation.mutate(page.id)}
                          disabled={deleteMutation.isPending}
                          className="btn-danger text-xs py-1 px-2"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="btn-ghost text-xs py-1"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Deploy result feedback */}
                {deployMutation.isSuccess && deployMutation.variables === page.id && (
                  <div className="flex items-center gap-2 text-xs text-emerald-400 mt-2">
                    <CheckCircle2 size={12} />
                    Deployed successfully
                  </div>
                )}
                {deployMutation.isError && deployMutation.variables === page.id && (
                  <div className="flex items-center gap-2 text-xs text-red-400 mt-2">
                    <XCircle size={12} />
                    Deploy failed
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
