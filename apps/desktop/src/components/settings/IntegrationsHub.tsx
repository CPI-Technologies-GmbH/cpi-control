import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { integrations as intApi, secrets as secApi } from '@/lib/api';
import { formatRelativeTime, statusBgColor } from '@/lib/formatters';
import { ProviderIcon } from '@/components/icons/ProviderIcons';
import {
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  Loader2,
  Plug,
  Upload,
  Trash2,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Save,
  Plus,
} from 'lucide-react';
import clsx from 'clsx';
import type { IntegrationConfig, SecretProvider } from '@/types';

/** Keys that should use file upload instead of text input */
const FILE_KEYS = new Set(['kubeconfig']);

/** Labels for secret keys */
const KEY_LABELS: Record<string, string> = {
  github_token: 'Personal Access Token',
  vercel_token: 'API Token',
  digitalocean_token: 'API Token',
  kubeconfig: 'Kubeconfig File',
  slack_webhook_url: 'Webhook URL',
  slack_bot_token: 'Bot Token',
  openai_api_key: 'API Key',
  bitbucket_token: 'App Password',
  semaphore_token: 'API Token',
};

export default function IntegrationsHub() {
  const qc = useQueryClient();
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});
  const [kubeconfigName, setKubeconfigName] = useState('');
  const [showKubeNameInput, setShowKubeNameInput] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  // Fetch providers (secrets) and integrations
  const { data: providers, isLoading: providersLoading } = useQuery({
    queryKey: ['secrets', 'providers'],
    queryFn: secApi.listProviders,
  });

  const { data: configs, isLoading: integrationsLoading } = useQuery({
    queryKey: ['integrations'],
    queryFn: intApi.list,
  });

  // Fetch kubeconfigs only when kubernetes provider is expanded
  const { data: kubeconfigs } = useQuery({
    queryKey: ['secrets', 'kubeconfigs'],
    queryFn: secApi.kubeconfigs,
    enabled: expandedProvider === 'kubernetes',
  });

  // Mutations
  const saveMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      secApi.save('', key, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['secrets'] });
      qc.invalidateQueries({ queryKey: ['integrations'] });
      setSecretInputs({});
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (key: string) => secApi.delete('', key),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['secrets'] });
      qc.invalidateQueries({ queryKey: ['integrations'] });
    },
  });

  const saveKubeconfigMutation = useMutation({
    mutationFn: ({ name, value }: { name: string; value: string }) =>
      secApi.saveKubeconfig(name, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['secrets'] });
      qc.invalidateQueries({ queryKey: ['integrations'] });
      setKubeconfigName('');
      setShowKubeNameInput(false);
    },
  });

  const deleteKubeconfigMutation = useMutation({
    mutationFn: (name: string) => secApi.deleteKubeconfig(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['secrets'] });
      qc.invalidateQueries({ queryKey: ['integrations'] });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      intApi.update(id, { enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] });
    },
  });

  const syncMutation = useMutation({
    mutationFn: (id: string) => intApi.sync(id),
    onSettled: () => {
      setSyncingId(null);
      qc.invalidateQueries({ queryKey: ['integrations'] });
    },
  });

  function handleFileUpload(secretKey: string) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.yml,.yaml,.json,.conf,.pem,.key,.txt';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const content = await file.text();
      saveMutation.mutate({ key: secretKey, value: content });
    };
    input.click();
  }

  function handleKubeconfigUpload(name: string) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.yml,.yaml,.json,.conf,.txt';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const content = await file.text();
      saveKubeconfigMutation.mutate({ name, value: content });
    };
    input.click();
  }

  function handleSaveSecret(key: string) {
    const value = secretInputs[key];
    if (!value?.trim()) return;
    saveMutation.mutate({ key, value });
  }

  function toggleExpand(providerId: string) {
    setExpandedProvider(expandedProvider === providerId ? null : providerId);
  }

  // Merge providers with integration data
  function getIntegrationForProvider(providerId: string): IntegrationConfig | undefined {
    return configs?.find((c) => c.provider === providerId);
  }

  const isLoading = providersLoading || integrationsLoading;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton w-full h-20 rounded-lg" />
        ))}
      </div>
    );
  }

  if (!providers || providers.length === 0) {
    return (
      <div className="card p-8 text-center">
        <Plug size={32} className="mx-auto text-gray-600 mb-3" />
        <p className="text-gray-400">No providers available</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {providers.map((prov) => {
        const integration = getIntegrationForProvider(prov.id);
        const isExpanded = expandedProvider === prov.id;
        const isConnected = prov.configured;

        return (
          <div key={prov.id} className="card overflow-hidden">
            {/* Provider Header */}
            <button
              onClick={() => toggleExpand(prov.id)}
              className="w-full p-4 flex items-center justify-between hover:bg-gray-800/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center">
                  <ProviderIcon provider={prov.id} size={22} />
                </div>
                <div className="text-left">
                  <h3 className="text-sm font-semibold text-gray-200">{prov.name}</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    {isConnected ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-400">
                        <CheckCircle2 size={12} />
                        Connected
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <XCircle size={12} />
                        Not configured
                      </span>
                    )}
                    {integration?.lastSyncStatus && (
                      <span
                        className={clsx(
                          'badge text-[10px] ml-2',
                          statusBgColor(integration.lastSyncStatus)
                        )}
                      >
                        {integration.lastSyncStatus}
                      </span>
                    )}
                    {integration?.lastSyncAt && (
                      <span className="text-xs text-gray-600">
                        synced {formatRelativeTime(integration.lastSyncAt)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {/* Sync button (only if integration exists and configured) */}
                {integration && isConnected && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSyncingId(integration.id);
                      syncMutation.mutate(integration.id);
                    }}
                    disabled={syncingId === integration.id}
                    className="btn-ghost text-xs flex items-center gap-1.5 py-1"
                  >
                    <RefreshCw
                      size={12}
                      className={syncingId === integration.id ? 'animate-spin' : ''}
                    />
                    Sync
                  </button>
                )}

                {/* Toggle enabled (only if integration exists) */}
                {integration && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleMutation.mutate({
                        id: integration.id,
                        enabled: !integration.enabled,
                      });
                    }}
                    disabled={toggleMutation.isPending}
                    className="text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    {integration.enabled ? (
                      <ToggleRight size={24} className="text-emerald-400" />
                    ) : (
                      <ToggleLeft size={24} className="text-gray-600" />
                    )}
                  </button>
                )}

                {isExpanded ? (
                  <ChevronDown size={16} className="text-gray-500" />
                ) : (
                  <ChevronRight size={16} className="text-gray-500" />
                )}
              </div>
            </button>

            {/* Expanded: Secrets + Config */}
            {isExpanded && (
              <div className="border-t border-gray-800 p-4 space-y-3 bg-gray-900/30">
                {/* Sync error */}
                {integration?.lastSyncError && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-400">
                    Last sync error: {integration.lastSyncError}
                  </div>
                )}

                {/* Kubernetes: named kubeconfig management */}
                {prov.id === 'kubernetes' ? (
                  <div className="space-y-3">
                    <label className="flex items-center gap-2 text-xs text-gray-400">
                      <span className="font-mono">kubeconfig</span>
                      <span className="text-gray-600">- Kubeconfig Files</span>
                    </label>

                    {/* List of existing kubeconfigs */}
                    {kubeconfigs && kubeconfigs.length > 0 ? (
                      <div className="space-y-2 pl-4">
                        {kubeconfigs.map((kc) => (
                          <div
                            key={kc.key}
                            className="flex items-center gap-3 py-1.5 px-3 bg-gray-800/50 rounded-lg"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                            <span className="text-xs text-gray-200 font-medium min-w-0 truncate">
                              {kc.name}
                            </span>
                            <span className="text-xs text-emerald-400 flex items-center gap-1 shrink-0">
                              <CheckCircle2 size={12} />
                              Uploaded
                            </span>
                            <button
                              onClick={() => handleKubeconfigUpload(kc.name)}
                              disabled={saveKubeconfigMutation.isPending}
                              className="btn-ghost text-xs flex items-center gap-1 py-0.5 shrink-0 ml-auto"
                            >
                              <Upload size={12} />
                              Replace
                            </button>
                            <button
                              onClick={() => deleteKubeconfigMutation.mutate(kc.name)}
                              disabled={deleteKubeconfigMutation.isPending}
                              className="text-gray-600 hover:text-red-400 transition-colors shrink-0"
                              title="Remove kubeconfig"
                            >
                              {deleteKubeconfigMutation.isPending ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Trash2 size={12} />
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-600 pl-4">
                        No kubeconfig files uploaded yet.
                      </p>
                    )}

                    {/* Add kubeconfig */}
                    <div className="pl-4">
                      {showKubeNameInput ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={kubeconfigName}
                            onChange={(e) => setKubeconfigName(e.target.value)}
                            className="input text-xs w-48"
                            placeholder="Config name (e.g. production)"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && kubeconfigName.trim()) {
                                handleKubeconfigUpload(kubeconfigName.trim());
                              }
                              if (e.key === 'Escape') {
                                setShowKubeNameInput(false);
                                setKubeconfigName('');
                              }
                            }}
                          />
                          <button
                            onClick={() => {
                              if (kubeconfigName.trim()) {
                                handleKubeconfigUpload(kubeconfigName.trim());
                              }
                            }}
                            disabled={
                              !kubeconfigName.trim() ||
                              saveKubeconfigMutation.isPending
                            }
                            className="btn-primary text-xs flex items-center gap-1.5 py-1.5"
                          >
                            {saveKubeconfigMutation.isPending ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Upload size={12} />
                            )}
                            Upload
                          </button>
                          <button
                            onClick={() => {
                              setShowKubeNameInput(false);
                              setKubeconfigName('');
                            }}
                            className="btn-ghost text-xs py-1.5"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setShowKubeNameInput(true)}
                          className="btn-secondary text-xs flex items-center gap-2 py-1.5"
                        >
                          <Plus size={14} />
                          Add Kubeconfig
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  /* Other providers: standard secret keys */
                  prov.keys.map((k) => {
                    const isFile = FILE_KEYS.has(k.key);
                    const label = KEY_LABELS[k.key] || k.key;

                    return (
                      <div key={k.key} className="space-y-1.5">
                        <label className="flex items-center gap-2 text-xs text-gray-400">
                          <span
                            className={clsx(
                              'w-1.5 h-1.5 rounded-full',
                              k.hasValue ? 'bg-emerald-500' : 'bg-gray-600'
                            )}
                          />
                          <span className="font-mono">{k.key}</span>
                          <span className="text-gray-600">- {label}</span>
                        </label>

                        {k.hasValue ? (
                          /* Secret is set - show status + delete */
                          <div className="flex items-center gap-2 pl-4">
                            <span className="text-xs text-emerald-400 flex items-center gap-1">
                              <CheckCircle2 size={12} />
                              {isFile ? 'File uploaded' : 'Secret saved'}
                            </span>
                            {isFile && (
                              <button
                                onClick={() => handleFileUpload(k.key)}
                                disabled={saveMutation.isPending}
                                className="btn-ghost text-xs flex items-center gap-1 py-0.5"
                              >
                                <Upload size={12} />
                                Replace
                              </button>
                            )}
                            <button
                              onClick={() => deleteMutation.mutate(k.key)}
                              disabled={deleteMutation.isPending}
                              className="text-gray-600 hover:text-red-400 transition-colors"
                              title="Remove secret"
                            >
                              {deleteMutation.isPending ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Trash2 size={12} />
                              )}
                            </button>
                          </div>
                        ) : isFile ? (
                          /* File upload */
                          <div className="pl-4">
                            <button
                              onClick={() => handleFileUpload(k.key)}
                              disabled={saveMutation.isPending}
                              className="btn-secondary text-xs flex items-center gap-2 py-1.5"
                            >
                              {saveMutation.isPending ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Upload size={14} />
                              )}
                              Upload {label}
                            </button>
                          </div>
                        ) : (
                          /* Text input for token/key */
                          <div className="flex items-center gap-2 pl-4">
                            <div className="relative flex-1 max-w-md">
                              <input
                                type={showValues[k.key] ? 'text' : 'password'}
                                value={secretInputs[k.key] || ''}
                                onChange={(e) =>
                                  setSecretInputs((prev) => ({
                                    ...prev,
                                    [k.key]: e.target.value,
                                  }))
                                }
                                className="input text-xs pr-8 w-full"
                                placeholder={`Enter ${label.toLowerCase()}`}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveSecret(k.key);
                                }}
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setShowValues((prev) => ({
                                    ...prev,
                                    [k.key]: !prev[k.key],
                                  }))
                                }
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                              >
                                {showValues[k.key] ? (
                                  <EyeOff size={12} />
                                ) : (
                                  <Eye size={12} />
                                )}
                              </button>
                            </div>
                            <button
                              onClick={() => handleSaveSecret(k.key)}
                              disabled={
                                saveMutation.isPending ||
                                !secretInputs[k.key]?.trim()
                              }
                              className="btn-primary text-xs flex items-center gap-1 py-1.5"
                            >
                              {saveMutation.isPending ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Save size={12} />
                              )}
                              Save
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}

                {/* Integration info */}
                {integration && (
                  <div className="flex items-center gap-4 text-xs text-gray-600 pt-2 border-t border-gray-800">
                    <span>
                      Sync interval:{' '}
                      {integration.syncIntervalSeconds
                        ? `${Math.round(integration.syncIntervalSeconds / 60)}min`
                        : '5min'}
                    </span>
                    <span>ID: {integration.id.slice(0, 8)}...</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
