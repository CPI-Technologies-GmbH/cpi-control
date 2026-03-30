import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { integrations as intApi } from '@/lib/api';
import { ProviderIcon } from '@/components/icons/ProviderIcons';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

const PROVIDER_NAMES: Record<string, string> = {
  github: 'GitHub',
  vercel: 'Vercel',
  kubernetes: 'Kubernetes',
  digitalocean: 'DigitalOcean',
  semaphore: 'Semaphore',
};

interface SyncStepProps {
  configuredProviders: string[];
  onComplete: () => void;
}

export default function SyncStep({ configuredProviders, onComplete }: SyncStepProps) {
  const [elapsed, setElapsed] = useState(0);
  const [autoAdvanced, setAutoAdvanced] = useState(false);
  const ensuredRef = useRef(false);
  const completedProviders = useRef<Set<string>>(new Set());

  // If no providers configured, auto-advance immediately
  useEffect(() => {
    if (configuredProviders.length === 0) {
      onComplete();
    }
  }, [configuredProviders, onComplete]);

  // Ensure integrations exist for all configured providers, then trigger sync
  useEffect(() => {
    if (ensuredRef.current || configuredProviders.length === 0) return;
    ensuredRef.current = true;

    (async () => {
      const existing = await intApi.list();
      for (const providerId of configuredProviders) {
        const found = existing.find((c) => c.provider === providerId);
        if (found) {
          intApi.sync(found.id).catch(() => {});
        } else {
          try {
            const created = await intApi.create({
              provider: providerId as any,
              name: PROVIDER_NAMES[providerId] || providerId,
              enabled: true,
            });
            intApi.sync(created.id).catch(() => {});
          } catch {
            // May already exist
          }
        }
      }
    })();
  }, [configuredProviders]);

  const { data: configs } = useQuery({
    queryKey: ['integrations'],
    queryFn: intApi.list,
    refetchInterval: 2000,
    enabled: configuredProviders.length > 0,
  });

  // Track elapsed time
  useEffect(() => {
    const timer = setInterval(() => setElapsed((p) => p + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Determine sync status per provider — once done/error, never revert to syncing
  const providerStatuses = configuredProviders.map((providerId) => {
    if (completedProviders.current.has(providerId)) {
      const config = configs?.find((c) => c.provider === providerId);
      const finalStatus = config?.lastSyncStatus === 'failed' ? 'error' as const : 'done' as const;
      return { providerId, status: finalStatus };
    }
    const config = configs?.find((c) => c.provider === providerId);
    if (!config) return { providerId, status: 'syncing' as const };
    if (config.lastSyncStatus === 'success' || config.lastSyncStatus === 'failed') {
      completedProviders.current.add(providerId);
      return { providerId, status: config.lastSyncStatus === 'failed' ? 'error' as const : 'done' as const };
    }
    return { providerId, status: 'syncing' as const };
  });

  const completedCount = providerStatuses.filter((p) => p.status === 'done' || p.status === 'error').length;
  const totalCount = providerStatuses.length;
  const allDone = totalCount > 0 && completedCount === totalCount;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // Auto-advance 1.5s after all complete
  useEffect(() => {
    if (allDone && !autoAdvanced) {
      const timer = setTimeout(() => {
        setAutoAdvanced(true);
        onComplete();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [allDone, autoAdvanced, onComplete]);

  return (
    <div className="w-full max-w-md animate-onboarding-slide-right text-center">
      <h2 className="text-2xl font-bold text-gray-100 mb-2">Synchronisierung</h2>
      <p className="text-gray-400 mb-8">
        Deine Services werden erkannt und importiert...
      </p>

      {/* Progress bar */}
      <div className="w-full bg-gray-800 rounded-full h-2 mb-8 overflow-hidden">
        <div
          className="bg-blue-500 h-2 rounded-full transition-all duration-500"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="space-y-3 mb-8">
        {providerStatuses.map(({ providerId, status }) => (
          <div key={providerId} className="card p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center shrink-0">
              <ProviderIcon provider={providerId} size={18} />
            </div>
            <span className="text-sm text-gray-200 flex-1 text-left">
              {PROVIDER_NAMES[providerId] || providerId}
            </span>
            {status === 'syncing' && <Loader2 size={16} className="text-blue-400 animate-spin" />}
            {status === 'done' && <CheckCircle2 size={16} className="text-emerald-400" />}
            {status === 'error' && <AlertCircle size={16} className="text-amber-400" />}
          </div>
        ))}
      </div>

      {/* Fallback button after 15s */}
      {elapsed >= 15 && !allDone && (
        <button onClick={onComplete} className="btn-ghost text-sm">
          Trotzdem fortfahren
        </button>
      )}

      {allDone && (
        <p className="text-sm text-gray-500 animate-pulse">
          Weiter in Kürze...
        </p>
      )}
    </div>
  );
}
