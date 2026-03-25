import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settings as settingsApi } from '@/lib/api';
import { Loader2, Save, CheckCircle2, RotateCcw, AlertTriangle } from 'lucide-react';

export default function GeneralSettings() {
  const qc = useQueryClient();
  const [logBufferSize, setLogBufferSize] = useState(10000);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetResult, setResetResult] = useState<{ success: boolean; deletedServices: number } | null>(null);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  useEffect(() => {
    if (settings) {
      setLogBufferSize(settings.logBufferSize);
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: (data: { logBufferSize: number }) => settingsApi.update(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      setSaved(true);
      setError(null);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => settingsApi.reset(),
    onSuccess: (data) => {
      setResetResult({ success: data.success, deletedServices: data.deletedServices });
      setShowResetConfirm(false);
      // Invalidate all queries to reflect fresh data
      qc.invalidateQueries();
      setTimeout(() => setResetResult(null), 5000);
    },
    onError: (err: Error) => {
      setResetResult(null);
      setShowResetConfirm(false);
      setError(`Reset failed: ${err.message}`);
    },
  });

  function validate(): boolean {
    if (logBufferSize < 1000 || logBufferSize > 100000) {
      setError('Buffer size must be between 1,000 and 100,000');
      return false;
    }
    if (!Number.isInteger(logBufferSize)) {
      setError('Buffer size must be a whole number');
      return false;
    }
    setError(null);
    return true;
  }

  function handleSave() {
    if (!validate()) return;
    updateMutation.mutate({ logBufferSize });
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="skeleton w-full h-32 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Log Settings */}
      <div className="card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-200">Log Collection</h3>
        <p className="text-xs text-gray-500">
          Configure background log collection from Kubernetes clusters. Logs are stored in an in-memory
          ring buffer for instant access.
        </p>

        <div className="space-y-2">
          <label className="block text-sm text-gray-400">
            Buffer Size
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={logBufferSize}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val)) {
                  setLogBufferSize(val);
                  setError(null);
                  setSaved(false);
                }
              }}
              className="input w-40"
              min={1000}
              max={100000}
              step={1000}
            />
            <span className="text-xs text-gray-500">entries (1,000 – 100,000)</span>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <p className="text-xs text-gray-600">
            Maximum number of log entries to keep in memory per namespace. Higher values use more RAM
            but provide longer history for instant queries.
          </p>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={updateMutation.isPending || saved}
            className="btn-primary text-sm flex items-center gap-2"
          >
            {updateMutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : saved ? (
              <CheckCircle2 size={14} className="text-emerald-400" />
            ) : (
              <Save size={14} />
            )}
            {saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>

      {/* Reset */}
      <div className="card p-5 space-y-4 border border-red-900/30">
        <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          <AlertTriangle size={14} className="text-red-400" />
          Data Reset
        </h3>
        <p className="text-xs text-gray-500">
          Delete all discovered services, deployments, incidents, and health check data.
          Integrations and secrets are preserved. A fresh sync is triggered immediately
          to re-discover services from all connected providers.
        </p>

        {resetResult && (
          <div className={`text-xs p-3 rounded-lg ${resetResult.success ? 'bg-emerald-900/20 text-emerald-400 border border-emerald-900/40' : 'bg-red-900/20 text-red-400 border border-red-900/40'}`}>
            {resetResult.success
              ? `Reset complete. ${resetResult.deletedServices} services deleted. Fresh sync triggered.`
              : 'Reset failed. Check logs for details.'}
          </div>
        )}

        {!showResetConfirm ? (
          <button
            onClick={() => setShowResetConfirm(true)}
            disabled={resetMutation.isPending}
            className="btn-danger text-sm flex items-center gap-2"
          >
            <RotateCcw size={14} />
            Reset All Data & Re-Sync
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-xs text-red-400">Are you sure? This cannot be undone.</span>
            <button
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending}
              className="btn-danger text-sm flex items-center gap-2"
            >
              {resetMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RotateCcw size={14} />
              )}
              {resetMutation.isPending ? 'Resetting...' : 'Yes, Reset'}
            </button>
            <button
              onClick={() => setShowResetConfirm(false)}
              disabled={resetMutation.isPending}
              className="btn-secondary text-sm"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
