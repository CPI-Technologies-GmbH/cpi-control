import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { license as api } from '@/lib/api';
import { Key, Shield, RefreshCw, Trash2, CheckCircle, AlertTriangle, Clock } from 'lucide-react';
import clsx from 'clsx';

const PLAN_LABELS: Record<string, { label: string; color: string }> = {
  free: { label: 'Free', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
  team: { label: 'Team', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  unlimited: { label: 'Unlimited', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
};

const STATUS_LABELS: Record<string, { label: string; icon: typeof CheckCircle; color: string }> = {
  active: { label: 'Active', icon: CheckCircle, color: 'text-green-400' },
  grace: { label: 'Offline Grace Period', icon: Clock, color: 'text-amber-400' },
  expired: { label: 'Expired', icon: AlertTriangle, color: 'text-red-400' },
  free: { label: 'Free Plan', icon: Shield, color: 'text-gray-400' },
};

export default function LicenseSettings() {
  const [licenseKey, setLicenseKey] = useState('');
  const [error, setError] = useState('');
  const qc = useQueryClient();

  const { data: licenseInfo, isLoading } = useQuery({
    queryKey: ['license'],
    queryFn: () => api.get(),
    refetchInterval: 60_000,
  });

  const activateMutation = useMutation({
    mutationFn: async (key: string) => {
      let machineId = 'unknown';
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        machineId = await invoke<string>('get_machine_id');
      } catch {
        machineId = `web-${Date.now()}`;
      }
      return api.activate({ licenseKey: key, machineId });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['license'] });
      setLicenseKey('');
      setError('');
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: () => api.deactivate(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['license'] });
    },
  });

  const validateMutation = useMutation({
    mutationFn: () => api.validate(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['license'] });
    },
  });

  const plan = licenseInfo?.plan || 'free';
  const status = licenseInfo?.status || 'free';
  const planInfo = PLAN_LABELS[plan] || PLAN_LABELS.free;
  const statusInfo = STATUS_LABELS[status] || STATUS_LABELS.free;
  const StatusIcon = statusInfo.icon;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="skeleton w-full h-32 rounded-lg" />
        <div className="skeleton w-full h-48 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Key size={20} className="text-blue-400" />
        <h1 className="text-xl font-bold text-gray-100">License</h1>
      </div>

      {/* Grace period warning */}
      {status === 'grace' && licenseInfo?.offlineSince && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 flex items-start gap-3">
          <Clock size={18} className="text-amber-400 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-400">Offline Grace Period</p>
            <p className="text-xs text-amber-400/70 mt-1">
              Unable to reach license server since {new Date(licenseInfo.offlineSince).toLocaleDateString('de-DE')}.
              Your license will remain active for 7 days offline. Connect to the internet to refresh.
            </p>
          </div>
        </div>
      )}

      {/* Current Plan Card */}
      <div className="card p-6">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-4">Current Plan</h2>
        <div className="flex items-center gap-4 mb-6">
          <span className={clsx('badge text-lg px-4 py-1', planInfo.color)}>
            {planInfo.label}
          </span>
          <span className={clsx('flex items-center gap-1.5 text-sm', statusInfo.color)}>
            <StatusIcon size={14} />
            {statusInfo.label}
          </span>
        </div>

        {/* Usage */}
        {licenseInfo && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span>Services</span>
                <span>{licenseInfo.usage.services} / {licenseInfo.limits.maxServices >= 99999 ? '∞' : licenseInfo.limits.maxServices}</span>
              </div>
              <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={clsx(
                    'h-full rounded-full transition-all',
                    licenseInfo.usage.services > licenseInfo.limits.maxServices ? 'bg-red-500' :
                    licenseInfo.usage.services > licenseInfo.limits.maxServices * 0.8 ? 'bg-amber-500' : 'bg-blue-500'
                  )}
                  style={{ width: `${Math.min(100, (licenseInfo.usage.services / Math.max(1, licenseInfo.limits.maxServices)) * 100)}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span>Remote Agents</span>
                <span>{licenseInfo.usage.agents} / {licenseInfo.limits.maxAgents >= 99 ? '∞' : licenseInfo.limits.maxAgents}</span>
              </div>
              <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={clsx(
                    'h-full rounded-full transition-all',
                    licenseInfo.usage.agents > licenseInfo.limits.maxAgents ? 'bg-red-500' : 'bg-blue-500'
                  )}
                  style={{ width: `${Math.min(100, (licenseInfo.usage.agents / Math.max(1, licenseInfo.limits.maxAgents)) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {licenseInfo?.expiresAt && (
          <p className="text-xs text-gray-500 mt-4">
            Expires: {new Date(licenseInfo.expiresAt).toLocaleDateString('de-DE', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        )}
        {licenseInfo?.lastValidated && (
          <p className="text-xs text-gray-600 mt-1">
            Last validated: {new Date(licenseInfo.lastValidated).toLocaleString('de-DE')}
          </p>
        )}
      </div>

      {/* Activate / Manage */}
      {plan === 'free' ? (
        <div className="card p-6">
          <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-4">Activate License</h2>
          <p className="text-sm text-gray-500 mb-4">
            Enter your license key to unlock Team or Unlimited features.
          </p>
          <div className="flex gap-3">
            <input
              type="text"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
              placeholder="CPI-XXXX-XXXX-XXXX-XXXX"
              className="input flex-1 font-mono text-sm tracking-wider"
            />
            <button
              onClick={() => activateMutation.mutate(licenseKey)}
              disabled={!licenseKey.trim() || activateMutation.isPending}
              className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
            >
              <Key size={14} />
              {activateMutation.isPending ? 'Activating...' : 'Activate'}
            </button>
          </div>
          {error && (
            <p className="text-xs text-red-400 mt-2">{error}</p>
          )}
          <div className="mt-4 pt-4 border-t border-gray-700/50">
            <a
              href="https://cpi-control-website.vercel.app/#pricing"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              Don&apos;t have a license key? Get one here &#8594;
            </a>
          </div>
        </div>
      ) : (
        <div className="card p-6">
          <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-4">Manage License</h2>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => validateMutation.mutate()}
              disabled={validateMutation.isPending}
              className="btn-ghost text-sm flex items-center gap-2 py-2"
            >
              <RefreshCw size={14} className={validateMutation.isPending ? 'animate-spin' : ''} />
              Refresh License
            </button>
            <a
              href="https://cpi-control-website.vercel.app/api/license/portal"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost text-sm flex items-center gap-2 py-2 text-blue-400"
            >
              <Shield size={14} />
              Manage Subscription
            </a>
            <button
              onClick={() => {
                if (window.confirm('Deactivate your license on this device? You can reactivate later.')) {
                  deactivateMutation.mutate();
                }
              }}
              disabled={deactivateMutation.isPending}
              className="btn-ghost text-sm flex items-center gap-2 py-2 text-red-400"
            >
              <Trash2 size={14} />
              Deactivate
            </button>
          </div>
        </div>
      )}

      {/* Upgrade CTA for free plan */}
      {plan === 'free' && (
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-6 text-center">
          <h3 className="text-lg font-semibold text-gray-100 mb-2">Upgrade to Team or Unlimited</h3>
          <p className="text-sm text-gray-400 mb-4">
            Get more services, remote agents, AI diagnostics, and priority support.
          </p>
          <a
            href="https://cpi-control-website.vercel.app/#pricing"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary inline-flex items-center gap-2 text-sm"
          >
            View Plans & Pricing &#8594;
          </a>
        </div>
      )}
    </div>
  );
}
