import AgentStatus from './AgentStatus';
import AgentInstaller from './AgentInstaller';
import AgentConfig from './AgentConfig';
import { Server } from 'lucide-react';

export default function AgentManagement() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Server size={20} className="text-blue-400" />
        <h1 className="text-xl font-bold text-gray-100">Agent Management</h1>
      </div>

      {/* Status */}
      <section>
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">
          Active Agents
        </h2>
        <AgentStatus />
      </section>

      {/* Installer */}
      <section>
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">
          Deploy New Agent
        </h2>
        <AgentInstaller />
      </section>

      {/* Config */}
      <section>
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">
          Configuration
        </h2>
        <AgentConfig />
      </section>
    </div>
  );
}
