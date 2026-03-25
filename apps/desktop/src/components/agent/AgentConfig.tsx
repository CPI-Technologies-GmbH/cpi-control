import { useAgentConfigPreview, useAgentSettings, useSyncAgent, useUpdateAgentSettings } from '@/hooks/useAgentStatus';
import { Settings, RefreshCw, Loader2, CheckCircle2 } from 'lucide-react';
import { useState, useEffect } from 'react';

interface AgentConfigProps {
  agentId?: string;
}

export default function AgentConfig({ agentId }: AgentConfigProps) {
  const { data: config, isLoading: configLoading } = useAgentConfigPreview(agentId);
  const { data: settings, isLoading: settingsLoading } = useAgentSettings(agentId);
  const syncMutation = useSyncAgent();
  const updateSettingsMutation = useUpdateAgentSettings();

  const [checkInterval, setCheckInterval] = useState(60);
  const [healthCheckEnabled, setHealthCheckEnabled] = useState(true);
  const [metricsEnabled, setMetricsEnabled] = useState(true);

  useEffect(() => {
    if (settings) {
      setCheckInterval(settings.checkIntervalSeconds);
      setHealthCheckEnabled(settings.healthCheckEnabled);
      setMetricsEnabled(settings.metricsEnabled);
    }
  }, [settings]);

  function handleSaveSettings() {
    if (!agentId) return;
    updateSettingsMutation.mutate({
      id: agentId,
      data: {
        checkIntervalSeconds: checkInterval,
        healthCheckEnabled,
        metricsEnabled,
      },
    });
  }

  return (
    <div className="space-y-6">
      {/* Config preview */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
            <Settings size={16} />
            Configuration
          </h3>
          <button
            onClick={() => agentId && syncMutation.mutate(agentId)}
            disabled={syncMutation.isPending || !agentId}
            className="btn-ghost flex items-center gap-2 text-sm py-1"
          >
            <RefreshCw size={14} className={syncMutation.isPending ? 'animate-spin' : ''} />
            Sync Now
          </button>
        </div>

        {syncMutation.isSuccess && (
          <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2 mb-4">
            <CheckCircle2 size={14} />
            Sync completed
          </div>
        )}

        {configLoading ? (
          <div className="skeleton w-full h-32 rounded-lg" />
        ) : config ? (
          <pre className="text-xs text-gray-300 bg-gray-900 rounded-lg p-4 overflow-x-auto max-h-64 overflow-y-auto">
            {JSON.stringify(config, null, 2)}
          </pre>
        ) : (
          <p className="text-sm text-gray-500">No configuration available</p>
        )}
      </div>

      {/* Agent settings */}
      <div className="card p-6">
        <h3 className="text-sm font-semibold text-gray-200 mb-4">Agent Settings</h3>

        {settingsLoading ? (
          <div className="space-y-3">
            <div className="skeleton w-full h-10 rounded" />
            <div className="skeleton w-full h-10 rounded" />
            <div className="skeleton w-full h-10 rounded" />
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Check Interval (seconds)
              </label>
              <input
                type="number"
                value={checkInterval}
                onChange={(e) => setCheckInterval(parseInt(e.target.value, 10) || 60)}
                className="input w-32"
                min={10}
                max={3600}
              />
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={healthCheckEnabled}
                onChange={(e) => setHealthCheckEnabled(e.target.checked)}
                className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500/50"
              />
              <span className="text-sm text-gray-300">Enable Health Checks</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={metricsEnabled}
                onChange={(e) => setMetricsEnabled(e.target.checked)}
                className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500/50"
              />
              <span className="text-sm text-gray-300">Enable Metrics Collection</span>
            </label>

            <button
              onClick={handleSaveSettings}
              disabled={updateSettingsMutation.isPending}
              className="btn-primary text-sm flex items-center gap-2"
            >
              {updateSettingsMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : null}
              Save Settings
            </button>

            {updateSettingsMutation.isSuccess && (
              <p className="text-xs text-emerald-400">Settings saved.</p>
            )}
            {updateSettingsMutation.isError && (
              <p className="text-xs text-red-400">Failed to save settings.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
