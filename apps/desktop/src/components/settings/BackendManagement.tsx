import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { RefreshCw, Circle, Terminal, ChevronDown, ChevronRight } from 'lucide-react';
import clsx from 'clsx';

interface BackendStatus {
  running: boolean;
  pid: number | null;
  uptimeSeconds: number | null;
  logCount: number;
}

function formatUptime(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function BackendManagement() {
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const result = await invoke<BackendStatus>('get_backend_status');
      setStatus(result);
      setDevMode(false);
    } catch {
      setDevMode(true);
      setStatus(null);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const result = await invoke<string[]>('get_backend_logs');
      setLogs(result);
    } catch {
      // Dev mode — no logs available
    }
  }, []);

  // Poll status every 2s
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Poll logs every 3s when open
  useEffect(() => {
    if (!logsOpen) return;
    fetchLogs();
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, [logsOpen, fetchLogs]);

  // Auto-scroll logs
  useEffect(() => {
    if (logsOpen && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, logsOpen]);

  const handleRestart = async () => {
    setRestarting(true);
    setError(null);
    try {
      await invoke('restart_backend');
      await fetchStatus();
    } catch (err: any) {
      setError(typeof err === 'string' ? err : err.message || 'Restart failed');
    } finally {
      setRestarting(false);
    }
  };

  if (devMode) {
    return (
      <div className="space-y-4">
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-3">
            <Terminal size={16} className="text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-200">Backend Process</h3>
          </div>
          <div className="flex items-center gap-2 text-sm text-yellow-400/80">
            <Circle size={8} className="fill-yellow-400 text-yellow-400" />
            Backend extern gestartet (Dev-Modus)
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Im Entwicklungsmodus wird das Backend separat gestartet. Prozessmanagement ist nur in der gebauten Desktop-App verfügbar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status Card */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Terminal size={16} className="text-gray-400" />
            <h3 className="text-sm font-semibold text-gray-200">Backend Process</h3>
          </div>
          <button
            onClick={handleRestart}
            disabled={restarting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={clsx(restarting && 'animate-spin')} />
            {restarting ? 'Restarting...' : 'Restart'}
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-xs text-gray-500 mb-1">Status</p>
            <div className="flex items-center gap-1.5">
              <Circle
                size={8}
                className={clsx(
                  'fill-current',
                  status?.running ? 'text-green-400' : 'text-red-400'
                )}
              />
              <span className={status?.running ? 'text-green-400' : 'text-red-400'}>
                {status?.running ? 'Running' : 'Stopped'}
              </span>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">PID</p>
            <p className="text-gray-200 font-mono">{status?.pid ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Uptime</p>
            <p className="text-gray-200">{formatUptime(status?.uptimeSeconds ?? null)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Log Lines</p>
            <p className="text-gray-200">{status?.logCount ?? 0}</p>
          </div>
        </div>

        {error && (
          <div className="mt-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
            {error}
          </div>
        )}
      </div>

      {/* Log Viewer */}
      <div className="card overflow-hidden">
        <button
          onClick={() => setLogsOpen(!logsOpen)}
          className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-gray-300 hover:bg-gray-800/50 transition-colors"
        >
          {logsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Terminal size={14} />
          Backend Logs
          {status?.logCount ? (
            <span className="text-xs text-gray-500 ml-auto">{status.logCount} lines</span>
          ) : null}
        </button>
        {logsOpen && (
          <div className="border-t border-gray-700/50 bg-gray-950 max-h-80 overflow-y-auto">
            <pre className="px-4 py-3 text-[11px] leading-relaxed text-gray-400 font-mono whitespace-pre-wrap">
              {logs.length > 0 ? logs.join('\n') : 'No logs available'}
              <div ref={logEndRef} />
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
