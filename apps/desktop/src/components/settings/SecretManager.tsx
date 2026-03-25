import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { secrets as api } from '@/lib/api';
import {
  Key,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Loader2,
  Shield,
  Upload,
} from 'lucide-react';
import clsx from 'clsx';

export default function SecretManager() {
  const qc = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [provider, setProvider] = useState('');
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: providers, isLoading: providersLoading } = useQuery({
    queryKey: ['secrets', 'providers'],
    queryFn: api.listProviders,
  });

  const { data: storeStatus, isLoading: statusLoading } = useQuery({
    queryKey: ['secrets', 'status'],
    queryFn: api.status,
  });

  const saveMutation = useMutation({
    mutationFn: () => api.save(provider, key, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['secrets'] });
      setShowAddForm(false);
      setProvider('');
      setKey('');
      setValue('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ p, k }: { p: string; k: string }) => api.delete(p, k),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['secrets'] });
    },
  });

  const fileUploadMutation = useMutation({
    mutationFn: ({ providerId, secretKey, content }: { providerId: string; secretKey: string; content: string }) =>
      api.save(providerId, secretKey, content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['secrets'] });
    },
  });

  const FILE_KEYS = new Set(['kubeconfig']);

  function handleFileUpload(providerId: string, secretKey: string) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.yml,.yaml,.json,.conf,.pem,.key';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const content = await file.text();
      fileUploadMutation.mutate({ providerId, secretKey, content });
    };
    input.click();
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!provider.trim()) errs.provider = 'Provider is required';
    if (!key.trim()) errs.key = 'Key is required';
    if (!value.trim()) errs.value = 'Value is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    saveMutation.mutate();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          <Shield size={16} />
          Secrets Management
        </h3>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="btn-primary text-sm flex items-center gap-2"
        >
          <Plus size={14} />
          Add Secret
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <form onSubmit={handleSave} className="card p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Provider <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="input"
                placeholder="e.g., github, vercel"
              />
              {errors.provider && <p className="text-xs text-red-400 mt-1">{errors.provider}</p>}
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Key <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className="input"
                placeholder="e.g., API_TOKEN"
              />
              {errors.key && <p className="text-xs text-red-400 mt-1">{errors.key}</p>}
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Value <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <input
                  type={showValue ? 'text' : 'password'}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="input pr-10"
                  placeholder="Secret value"
                />
                <button
                  type="button"
                  onClick={() => setShowValue(!showValue)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                >
                  {showValue ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {errors.value && <p className="text-xs text-red-400 mt-1">{errors.value}</p>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={saveMutation.isPending} className="btn-primary text-sm">
              {saveMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                'Save Secret'
              )}
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="btn-secondary text-sm"
            >
              Cancel
            </button>
          </div>
          {saveMutation.isError && (
            <p className="text-xs text-red-400">Failed to save secret.</p>
          )}
        </form>
      )}

      {/* Providers */}
      {providersLoading || statusLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton w-full h-14 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {providers?.map((prov) => (
            <div key={prov.id} className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <Key size={16} className="text-gray-500" />
                  <div>
                    <h4 className="text-sm font-medium text-gray-200">{prov.name}</h4>
                    <p className="text-xs text-gray-500">
                      {prov.configured ? 'Configured' : 'Not configured'}
                    </p>
                  </div>
                </div>
                {prov.configured ? (
                  <CheckCircle2 size={16} className="text-emerald-400" />
                ) : (
                  <XCircle size={16} className="text-gray-600" />
                )}
              </div>
              {prov.keys.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {prov.keys.map((k: { key: string; hasValue: boolean }) => {
                    const isFileKey = FILE_KEYS.has(k.key);
                    return (
                      <div
                        key={k.key}
                        className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-1.5"
                      >
                        <span
                          className={clsx(
                            'w-1.5 h-1.5 rounded-full',
                            k.hasValue ? 'bg-emerald-500' : 'bg-gray-600'
                          )}
                        />
                        <span className="text-xs text-gray-300 font-mono">{k.key}</span>
                        {isFileKey && (
                          <button
                            onClick={() => handleFileUpload(prov.id, k.key)}
                            disabled={fileUploadMutation.isPending}
                            className="text-gray-500 hover:text-blue-400 transition-colors"
                            title="Upload file"
                          >
                            {fileUploadMutation.isPending ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Upload size={12} />
                            )}
                          </button>
                        )}
                        {k.hasValue && (
                          <button
                            onClick={() => deleteMutation.mutate({ p: prov.id, k: k.key })}
                            className="text-gray-600 hover:text-red-400 transition-colors"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
