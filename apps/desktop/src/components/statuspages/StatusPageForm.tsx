import { useState, useRef } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { statusPages as api, services as servicesApi, projects as projectsApi } from '@/lib/api';
import type { StatusPage, RemoteAgent, Service, Project } from '@/types';
import { X, Loader2, Moon, Sun, Minus, Globe, Check, Upload, Rocket } from 'lucide-react';
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

type SelectionMode = 'services' | 'projects';

export default function StatusPageForm({ page, agents, onClose }: Props) {
  const queryClient = useQueryClient();
  const isEditing = !!page;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(page?.name || '');
  const [domain, setDomain] = useState(page?.domain || '');
  const [agentId, setAgentId] = useState(page?.agentId || (agents.length > 0 ? agents[0].id : ''));
  const [theme, setTheme] = useState<'dark' | 'light' | 'minimal'>(page?.theme || 'dark');
  const [brandingLogo, setBrandingLogo] = useState(page?.brandingLogo || '');
  const [brandingColor, setBrandingColor] = useState(page?.brandingColor || '#3b82f6');
  const [brandingCompany, setBrandingCompany] = useState(page?.brandingCompany || '');
  const [isActive, setIsActive] = useState(page?.isActive !== false);
  const [logoUploading, setLogoUploading] = useState(false);

  // Selection mode
  const pageConfig = (page?.config || {}) as Record<string, unknown>;
  const initialMode: SelectionMode = pageConfig.projects ? 'projects' : 'services';
  const [selectionMode, setSelectionMode] = useState<SelectionMode>(initialMode);

  // Service selection
  const { data: allServices } = useQuery({
    queryKey: ['services'],
    queryFn: () => servicesApi.list(),
  });
  const selectedServiceIds = (pageConfig.services as string[] | undefined) || [];
  const [serviceIds, setServiceIds] = useState<string[]>(selectedServiceIds);

  // Project selection
  const { data: allProjects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  });
  const selectedProjectIds = (pageConfig.projectIds as string[] | undefined) || [];
  const [projectIds, setProjectIds] = useState<string[]>(selectedProjectIds);

  const [deploying, setDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState<'success' | 'error' | null>(null);

  const [limitError, setLimitError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: Partial<StatusPage>) => api.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['statuspages'] }); onClose(); },
    onError: (err: Error) => {
      if (err.message.includes('403')) {
        try { setLimitError(JSON.parse(err.message.match(/- (.+)$/)?.[1] || '{}').error); } catch { setLimitError('Status page limit reached. Please upgrade your plan.'); }
      }
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<StatusPage> }) => api.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['statuspages'] }); },
  });
  const isPending = createMutation.isPending || updateMutation.isPending;

  async function handleSaveAndDeploy(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !domain.trim() || !agentId) return;

    const data = buildFormData();
    setDeploying(true);
    setDeployResult(null);

    try {
      let pageId = page?.id;
      if (isEditing && page) {
        await updateMutation.mutateAsync({ id: page.id, data });
      } else {
        const created = await createMutation.mutateAsync(data);
        pageId = (created as any).id;
      }
      if (pageId) {
        await api.deploy(pageId);
        setDeployResult('success');
        setTimeout(() => onClose(), 1500);
      }
    } catch {
      setDeployResult('error');
    } finally {
      setDeploying(false);
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!agentId) { alert('Please select an agent first'); return; }

    setLogoUploading(true);
    try {
      // Convert file to base64 data URI for now
      // In production: upload to agent via SSH and use a served URL
      const reader = new FileReader();
      reader.onload = () => {
        setBrandingLogo(reader.result as string);
        setLogoUploading(false);
      };
      reader.onerror = () => {
        alert('Failed to read file');
        setLogoUploading(false);
      };
      reader.readAsDataURL(file);
    } catch {
      setLogoUploading(false);
    }
  }

  function buildFormData(): Partial<StatusPage> {
    const config: Record<string, unknown> = {};
    if (selectionMode === 'services') {
      config.services = serviceIds;
    } else {
      config.projectIds = projectIds;
      config.projects = (allProjects || [])
        .filter((p) => projectIds.includes(p.id))
        .map((p) => ({
          project_id: p.id,
          public_name: p.name,
          public_description: p.notes || '',
          services: (allServices || [])
            .filter((s) => s.projectId === p.id)
            .map((s) => ({
              service_id: s.id,
              public_name: s.publicName || s.name,
              public_description: s.publicDescription || '',
              show_response_time: s.type === 'website',
            })),
        }));
    }

    return {
      name: name.trim(),
      domain: domain.trim(),
      agentId,
      theme,
      brandingLogo: brandingLogo.trim() || null,
      brandingColor: brandingColor.trim() || null,
      brandingCompany: brandingCompany.trim() || null,
      config,
      isActive,
    };
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !domain.trim() || !agentId) return;

    const data = buildFormData();
    if (isEditing && page) {
      updateMutation.mutate({ id: page.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  function toggleService(id: string) {
    setServiceIds((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]);
  }
  function toggleProject(id: string) {
    setProjectIds((prev) => prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]);
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

      {limitError && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-start gap-3 mb-4">
          <span className="text-amber-400 text-lg mt-0.5">&#9888;</span>
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-300">{limitError}</p>
            <a href="https://cpi-control-website.vercel.app/login" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300 mt-1 inline-block">
              Upgrade your plan &rarr;
            </a>
          </div>
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Basic Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Name <span className="text-red-400">*</span></label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="input w-full py-2 text-sm" placeholder="My Status Page" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Domain <span className="text-red-400">*</span></label>
            <input type="text" value={domain} onChange={(e) => setDomain(e.target.value)} className="input w-full py-2 text-sm" placeholder="status.example.com" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Agent <span className="text-red-400">*</span></label>
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="input w-full py-2 text-sm">
              <option value="">Select an agent...</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.host})</option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500/30" />
              <span className="text-sm text-gray-300">Active</span>
            </label>
          </div>
        </div>

        {/* Theme Selector */}
        <div>
          <label className="block text-xs text-gray-500 mb-2">Theme</label>
          <div className="grid grid-cols-3 gap-3">
            {themes.map((t) => (
              <button key={t.value} type="button" onClick={() => setTheme(t.value)}
                className={clsx('p-3 rounded-lg border text-left transition-all', theme === t.value ? 'border-blue-500/50 bg-blue-500/10' : 'border-gray-700 bg-gray-800/50 hover:border-gray-600')}>
                <div className="flex items-center gap-2 mb-1">
                  <t.icon size={14} className={theme === t.value ? 'text-blue-400' : 'text-gray-500'} />
                  <span className={clsx('text-sm font-medium', theme === t.value ? 'text-blue-400' : 'text-gray-300')}>{t.label}</span>
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
              <input type="text" value={brandingCompany} onChange={(e) => setBrandingCompany(e.target.value)} className="input w-full py-2 text-sm" placeholder="ACME Inc." />
            </div>
            <div>
              <label className="block text-[11px] text-gray-600 mb-1">Logo</label>
              <div className="flex items-center gap-2">
                {brandingLogo && (
                  <img src={brandingLogo} alt="Logo" className="w-8 h-8 rounded object-contain bg-gray-800" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                )}
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={logoUploading}
                  className="btn-ghost py-1.5 text-xs flex items-center gap-1.5 flex-1">
                  {logoUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                  {brandingLogo ? 'Change Logo' : 'Upload Logo'}
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                {brandingLogo && (
                  <button type="button" onClick={() => setBrandingLogo('')} className="text-gray-600 hover:text-gray-400">
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-gray-600 mb-1">Primary Color</label>
              <div className="flex items-center gap-2">
                <input type="color" value={brandingColor} onChange={(e) => setBrandingColor(e.target.value)} className="w-8 h-8 rounded border border-gray-700 cursor-pointer bg-transparent" />
                <input type="text" value={brandingColor} onChange={(e) => setBrandingColor(e.target.value)} className="input flex-1 py-2 text-sm font-mono" placeholder="#3b82f6" />
              </div>
            </div>
          </div>
        </div>

        {/* Selection Mode Toggle */}
        <div>
          <div className="flex items-center gap-4 mb-3">
            <label className="block text-xs text-gray-500">Content</label>
            <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-0.5">
              <button type="button" onClick={() => setSelectionMode('projects')}
                className={clsx('px-3 py-1 text-xs font-medium rounded-md transition-colors', selectionMode === 'projects' ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300')}>
                By Project
              </button>
              <button type="button" onClick={() => setSelectionMode('services')}
                className={clsx('px-3 py-1 text-xs font-medium rounded-md transition-colors', selectionMode === 'services' ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300')}>
                By Service
              </button>
            </div>
          </div>

          {selectionMode === 'projects' ? (
            <div>
              <p className="text-[11px] text-gray-600 mb-2">Select projects — all services within selected projects will be shown with their public names.</p>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-700 bg-gray-800/50 divide-y divide-gray-700/50">
                {(!allProjects || allProjects.length === 0) ? (
                  <p className="text-xs text-gray-500 p-3">No projects available</p>
                ) : (
                  allProjects.map((proj: Project) => {
                    const svcCount = (allServices || []).filter((s) => s.projectId === proj.id).length;
                    return (
                      <label key={proj.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-700/30 cursor-pointer transition-colors">
                        <input type="checkbox" checked={projectIds.includes(proj.id)} onChange={() => toggleProject(proj.id)}
                          className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500/30" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {proj.icon && <span className="text-sm">{proj.icon}</span>}
                            <span className="text-sm text-gray-300 font-medium">{proj.name}</span>
                          </div>
                          <span className="text-[11px] text-gray-600">{svcCount} service{svcCount !== 1 ? 's' : ''}</span>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
              {projectIds.length > 0 && (
                <p className="text-[11px] text-gray-500 mt-2">
                  {projectIds.length} project{projectIds.length !== 1 ? 's' : ''} selected — {(allServices || []).filter((s) => s.projectId && projectIds.includes(s.projectId)).length} services will be shown
                </p>
              )}
            </div>
          ) : (
            <div>
              <p className="text-[11px] text-gray-600 mb-2">Select individual services to show on the status page.</p>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-700 bg-gray-800/50 divide-y divide-gray-700/50">
                {(!allServices || allServices.length === 0) ? (
                  <p className="text-xs text-gray-500 p-3">No services available</p>
                ) : (
                  allServices.map((svc: Service) => (
                    <label key={svc.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-700/30 cursor-pointer transition-colors">
                      <input type="checkbox" checked={serviceIds.includes(svc.id)} onChange={() => toggleService(svc.id)}
                        className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500/30" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-gray-300 truncate block">{svc.name}</span>
                        {svc.projectName && <span className="text-[11px] text-cyan-400/70">{svc.projectName}</span>}
                      </div>
                      <span className={clsx('text-[10px] px-1.5 py-0.5 rounded',
                        svc.status === 'healthy' ? 'bg-emerald-500/10 text-emerald-400' :
                        svc.status === 'degraded' ? 'bg-amber-500/10 text-amber-400' :
                        svc.status === 'down' ? 'bg-red-500/10 text-red-400' :
                        'bg-gray-700/50 text-gray-500'
                      )}>{svc.status}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button type="submit" disabled={isPending || deploying || !name.trim() || !domain.trim() || !agentId} className="btn-secondary flex items-center gap-2">
            {isPending ? (<><Loader2 size={14} className="animate-spin" />Saving...</>) :
              (<><Check size={14} />{isEditing ? 'Save' : 'Create'}</>)}
          </button>
          <button type="button" onClick={handleSaveAndDeploy} disabled={isPending || deploying || !name.trim() || !domain.trim() || !agentId}
            className="btn-primary flex items-center gap-2">
            {deploying ? (<><Loader2 size={14} className="animate-spin" />Deploying...</>) :
              (<><Rocket size={14} />Save &amp; Deploy</>)}
          </button>
          <button type="button" onClick={onClose} className="btn-ghost text-sm">Cancel</button>
          {deployResult === 'success' && <span className="text-xs text-emerald-400">Deployed successfully!</span>}
          {deployResult === 'error' && !limitError && <span className="text-xs text-red-400">Deploy failed</span>}
          {(createMutation.isError || updateMutation.isError) && !limitError && (
            <span className="text-xs text-red-400">Failed to save</span>
          )}
        </div>
      </form>
    </div>
  );
}
