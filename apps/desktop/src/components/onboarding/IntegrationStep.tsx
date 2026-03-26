import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { secrets as secApi, integrations as intApi } from '@/lib/api';
import { ProviderIcon } from '@/components/icons/ProviderIcons';
import { Loader2, CheckCircle2, Upload, Eye, EyeOff, Save } from 'lucide-react';
import clsx from 'clsx';

interface IntegrationStepProps {
  onNext: () => void;
  onSkip: () => void;
  onProvidersSaved: (providers: string[]) => void;
}

interface ProviderDef {
  id: string;
  name: string;
  desc: string;
  secretKey: string;
  isFile?: boolean;
}

const PROVIDERS: ProviderDef[] = [
  { id: 'github', name: 'GitHub', desc: 'Repositories und Actions', secretKey: 'github_token' },
  { id: 'vercel', name: 'Vercel', desc: 'Deployments und Projekte', secretKey: 'vercel_token' },
  { id: 'kubernetes', name: 'Kubernetes', desc: 'Cluster und Workloads', secretKey: 'kubeconfig', isFile: true },
  { id: 'digitalocean', name: 'DigitalOcean', desc: 'Droplets und Apps', secretKey: 'digitalocean_token' },
  { id: 'semaphore', name: 'Semaphore', desc: 'CI/CD Pipelines', secretKey: 'semaphore_token' },
];

export default function IntegrationStep({ onNext, onSkip, onProvidersSaved }: IntegrationStepProps) {
  const qc = useQueryClient();
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<string | null>(null);

  const { data: providers } = useQuery({
    queryKey: ['secrets', 'providers'],
    queryFn: secApi.listProviders,
  });

  // Pre-populate saved state from already-configured providers
  useEffect(() => {
    if (!providers) return;
    const configured = new Set<string>();
    for (const p of providers) {
      if (p.configured) configured.add(p.id);
    }
    if (configured.size > 0) setSaved(configured);
  }, [providers]);

  // Notify parent of saved providers
  useEffect(() => {
    onProvidersSaved(Array.from(saved));
  }, [saved, onProvidersSaved]);

  const saveMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      secApi.save('', key, value),
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
    },
  });

  async function handleSave(prov: ProviderDef) {
    if (prov.isFile) return; // handled by file upload
    const value = inputs[prov.id];
    if (!value?.trim()) return;

    setSaving(prov.id);
    try {
      await saveMutation.mutateAsync({ key: prov.secretKey, value });
      // Auto-create integration + trigger sync
      try {
        const integration = await intApi.create({ provider: prov.id as any, name: prov.name, enabled: true });
        await intApi.sync(integration.id);
      } catch {
        // Integration might already exist — that's fine
      }
      setSaved((prev) => new Set(prev).add(prov.id));
      setInputs((prev) => ({ ...prev, [prov.id]: '' }));
    } finally {
      setSaving(null);
    }
  }

  function handleFileUpload(prov: ProviderDef) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.yml,.yaml,.json,.conf,.txt';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const content = await file.text();
      setSaving(prov.id);
      try {
        await saveKubeconfigMutation.mutateAsync({ name: file.name.replace(/\.[^.]+$/, ''), value: content });
        try {
          const integration = await intApi.create({ provider: 'kubernetes' as any, name: 'Kubernetes', enabled: true });
          await intApi.sync(integration.id);
        } catch {
          // Integration might already exist
        }
        setSaved((prev) => new Set(prev).add(prov.id));
      } finally {
        setSaving(null);
      }
    };
    input.click();
  }

  const hasSaved = saved.size > 0;

  return (
    <div className="w-full max-w-lg animate-onboarding-slide-right">
      <h2 className="text-2xl font-bold text-gray-100 mb-2 text-center">Integrationen</h2>
      <p className="text-gray-400 mb-8 text-center">
        Verbinde deine Infrastruktur-Provider. Du kannst weitere jederzeit unter Einstellungen hinzufügen.
      </p>

      <div className="space-y-3 mb-8">
        {PROVIDERS.map((prov) => {
          const isSaved = saved.has(prov.id);
          const isSaving = saving === prov.id;

          return (
            <div key={prov.id} className={clsx('card p-4', isSaved && 'border-emerald-500/30')}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center shrink-0">
                  <ProviderIcon provider={prov.id} size={22} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-200">{prov.name}</span>
                    {isSaved && <CheckCircle2 size={14} className="text-emerald-400" />}
                  </div>
                  <span className="text-xs text-gray-500">{prov.desc}</span>
                </div>
              </div>

              {isSaved ? (
                <div className="text-xs text-emerald-400 flex items-center gap-1 pl-[52px]">
                  <CheckCircle2 size={12} />
                  Konfiguriert
                </div>
              ) : prov.isFile ? (
                <div className="pl-[52px]">
                  <button
                    onClick={() => handleFileUpload(prov)}
                    disabled={isSaving}
                    className="btn-secondary text-xs flex items-center gap-2 py-1.5"
                  >
                    {isSaving ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Upload size={14} />
                    )}
                    Kubeconfig hochladen
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 pl-[52px]">
                  <div className="relative flex-1">
                    <input
                      type={showValues[prov.id] ? 'text' : 'password'}
                      value={inputs[prov.id] || ''}
                      onChange={(e) => setInputs((prev) => ({ ...prev, [prov.id]: e.target.value }))}
                      className="input text-xs pr-8 w-full"
                      placeholder="API Token eingeben"
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSave(prov); }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowValues((prev) => ({ ...prev, [prov.id]: !prev[prov.id] }))}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                    >
                      {showValues[prov.id] ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  </div>
                  <button
                    onClick={() => handleSave(prov)}
                    disabled={isSaving || !inputs[prov.id]?.trim()}
                    className="btn-primary text-xs flex items-center gap-1 py-1.5"
                  >
                    {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    Speichern
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-3">
        <button onClick={onSkip} className="btn-ghost">
          Überspringen
        </button>
        {hasSaved && (
          <button onClick={onNext} className="btn-primary px-6">
            Weiter
          </button>
        )}
      </div>
    </div>
  );
}
