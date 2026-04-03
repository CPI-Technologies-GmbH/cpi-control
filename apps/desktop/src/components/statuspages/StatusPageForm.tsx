import { useState } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { statusPages as api, services as servicesApi } from '@/lib/api';
import type { StatusPage, RemoteAgent, Service } from '@/types';
import { X, Loader2, Moon, Sun, Minus, Globe, Check } from 'lucide-react';
import clsx from 'clsx';

interface Props {
  page: StatusPage | null;
  agents: RemoteAgent[];
  onClose: () => void;
}

const themes = [
  { value: 'dark' as const, label: 'Dark', icon: Moon, desc: 'Dark background, light text' },
  { value: 'light' as const, label: 'Light', icon: Sun, desc: 'Light background, dark text' },
  { value: 'minimal' as const, label: 'Minimal', icon: Minus, desc: 'Clean, borderless design' },
];

export default function StatusPageForm({ page, agents, onClose }: Props) {
  const queryClient = useQueryClient();
  const isEditing = !!page;

  const [name, setName] = useState(page?.name || '');
  const [domain, setDomain] = useState(page?.domain || '');
  const [agentId, setAgentId] = useState(page?.agentId || (agents.length > 0 ? agents[0].id : ''));
  const [theme, setTheme] = useState<'dark' | 'light' | 'minimal'>(page?.theme || 'dark');
  const [brandingLogo, setBrandingLogo] = useState(page?.brandingLogo || '');
  const [brandingColor, setBrandingColor] = useState(page?.brandingColor || '#3b82f6');
  const [brandingCompany, setBrandingCompany] = useState(page?.brandingCompany || '');
  const [isActive, setIsActive] = useState(page?.isActive !== false);

  // Service selection for config
  const { data: allServices } = useQuery({
    queryKey: ['services'],
    queryFn: () => servicesApi.list(),
  });

  const pageConfig = (page?.config || {}) as Record<string, unknown>;
  const selectedServiceIds = (pageConfig.services as string[] | undefined) || [];
  const [serviceIds, setServiceIds] = useState<string[]>(selectedServiceIds);

  const createMutation = useMutation({
    mutationFn: (data: Partial<StatusPage>) => api.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['statuspages'] });
      onClose();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<StatusPage> }) => api.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['statuspages'] });
      onClose();
    },
  });

  const mutation = isEditing ? updateMutation : createMutation;
  const isPending = createMutation.isPending || updateMutation.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !domain.trim() || !agentId) return;

    const data: Partial<StatusPage> = {
      name: name.trim(),
      domain: domain.trim(),
      agentId,
      theme,
      brandingLogo: brandingLogo.trim() || null,
      brandingColor: brandingColor.trim() || null,
      brandingCompany: brandingCompany.trim() || null,
      config: { services: serviceIds },
      isActive,
    };

    if (isEditing && page) {
      updateMutation.mutate({ id: page.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  function toggleService(id: string) {
    setServiceIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  return (
    <div className="card p-6 border border-blue-500/30">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          <Globe size={16} />
          {isEditing ? 'Edit Status Page' : 'Create Status Page'}
        </h2>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
          <X size={16} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Basic Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">
              Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input w-full py-2 text-sm"
              placeholder="My Status Page"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">
              Domain <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="input w-full py-2 text-sm"
              placeholder="status.example.com"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">
              Agent <span className="text-red-400">*</span>
            </label>
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="input w-full py-2 text-sm"
            >
              <option value="">Select an agent...</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.host})
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500/30"
              />
              <span className="text-sm text-gray-300">Active</span>
            </label>
          </div>
        </div>

        {/* Theme Selector */}
        <div>
          <label className="block text-xs text-gray-500 mb-2">Theme</label>
          <div className="grid grid-cols-3 gap-3">
            {themes.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTheme(t.value)}
                className={clsx(
                  'p-3 rounded-lg border text-left transition-all',
                  theme === t.value
                    ? 'border-blue-500/50 bg-blue-500/10'
                    : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <t.icon size={14} className={theme === t.value ? 'text-blue-400' : 'text-gray-500'} />
                  <span className={clsx('text-sm font-medium', theme === t.value ? 'text-blue-400' : 'text-gray-300')}>
                    {t.label}
                  </span>
                  {theme === t.value && <Check size={12} className="text-blue-400 ml-auto" />}
                </div>
                <p className="text-[11px] text-gray-500">{t.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Branding */}
        <div>
          <label className="block text-xs text-gray-500 mb-2">Branding</label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[11px] text-gray-600 mb-1">Company Name</label>
              <input
                type="text"
                value={brandingCompany}
                onChange={(e) => setBrandingCompany(e.target.value)}
                className="input w-full py-2 text-sm"
                placeholder="ACME Inc."
              />
            </div>
            <div>
              <label className="block text-[11px] text-gray-600 mb-1">Logo URL</label>
              <input
                type="text"
                value={brandingLogo}
                onChange={(e) => setBrandingLogo(e.target.value)}
                className="input w-full py-2 text-sm"
                placeholder="https://example.com/logo.png"
              />
            </div>
            <div>
              <label className="block text-[11px] text-gray-600 mb-1">Primary Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={brandingColor}
                  onChange={(e) => setBrandingColor(e.target.value)}
                  className="w-8 h-8 rounded border border-gray-700 cursor-pointer bg-transparent"
                />
                <input
                  type="text"
                  value={brandingColor}
                  onChange={(e) => setBrandingColor(e.target.value)}
                  className="input flex-1 py-2 text-sm font-mono"
                  placeholder="#3b82f6"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Service Selector */}
        <div>
          <label className="block text-xs text-gray-500 mb-2">
            Services ({serviceIds.length} selected)
          </label>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-700 bg-gray-800/50 divide-y divide-gray-700/50">
            {(!allServices || allServices.length === 0) ? (
              <p className="text-xs text-gray-500 p-3">No services available</p>
            ) : (
              allServices.map((svc: Service) => (
                <label
                  key={svc.id}
                  className="flex items-center gap-3 px-3 py-2 hover:bg-gray-700/30 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={serviceIds.includes(svc.id)}
                    onChange={() => toggleService(svc.id)}
                    className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500/30"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-gray-300 truncate block">{svc.name}</span>
                    {svc.url && (
                      <span className="text-[11px] text-gray-600 truncate block">{svc.url}</span>
                    )}
                  </div>
                  <span className={clsx(
                    'text-[10px] px-1.5 py-0.5 rounded',
                    svc.status === 'healthy' ? 'bg-emerald-500/10 text-emerald-400' :
                    svc.status === 'degraded' ? 'bg-amber-500/10 text-amber-400' :
                    svc.status === 'down' ? 'bg-red-500/10 text-red-400' :
                    'bg-gray-700/50 text-gray-500'
                  )}>
                    {svc.status}
                  </span>
                </label>
              ))
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={isPending || !name.trim() || !domain.trim() || !agentId}
            className="btn-primary flex items-center gap-2"
          >
            {isPending ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {isEditing ? 'Saving...' : 'Creating...'}
              </>
            ) : (
              <>
                <Check size={14} />
                {isEditing ? 'Save Changes' : 'Create Status Page'}
              </>
            )}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          {(createMutation.isError || updateMutation.isError) && (
            <span className="text-xs text-red-400">
              Failed to {isEditing ? 'update' : 'create'} status page
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
