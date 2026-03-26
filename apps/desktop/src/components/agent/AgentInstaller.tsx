import { useState } from 'react';
import { useInstallAgent } from '@/hooks/useAgentStatus';
import { Server, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

export default function AgentInstaller() {
  const [host, setHost] = useState('');
  const [username, setUsername] = useState('root');
  const [sshKeyPath, setSshKeyPath] = useState('~/.ssh/id_rsa');
  const [port, setPort] = useState('22');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const installMutation = useInstallAgent();

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!host.trim()) errs.host = 'Host IP or hostname is required';
    if (!username.trim()) errs.username = 'SSH username is required';
    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) errs.port = 'Invalid port number';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    installMutation.mutate({
      name: host.trim(),
      host: host.trim(),
      username: username.trim(),
      sshKeyPath: sshKeyPath.trim() || undefined,
      port: parseInt(port, 10),
    });
  }

  return (
    <div className="card p-6">
      <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2 mb-4">
        <Server size={16} />
        Install Agent
      </h3>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Droplet IP / Host <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              className="input"
              placeholder="192.168.1.100"
            />
            {errors.host && <p className="text-xs text-red-400 mt-1">{errors.host}</p>}
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              SSH User <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input"
              placeholder="root"
            />
            {errors.username && <p className="text-xs text-red-400 mt-1">{errors.username}</p>}
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">SSH Key Path</label>
            <input
              type="text"
              value={sshKeyPath}
              onChange={(e) => setSshKeyPath(e.target.value)}
              className="input"
              placeholder="~/.ssh/id_rsa"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Port</label>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className="input"
              placeholder="22"
              min={1}
              max={65535}
            />
            {errors.port && <p className="text-xs text-red-400 mt-1">{errors.port}</p>}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={installMutation.isPending} className="btn-primary flex items-center gap-2">
            {installMutation.isPending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Installing...
              </>
            ) : (
              <>
                <Server size={16} />
                Install Agent
              </>
            )}
          </button>
        </div>

        {installMutation.isSuccess && (
          <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
            <CheckCircle2 size={16} />
            Agent installed successfully!
          </div>
        )}

        {installMutation.isError && (
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
            <AlertCircle size={16} />
            Installation failed. Check the host credentials and try again.
          </div>
        )}
      </form>
    </div>
  );
}
