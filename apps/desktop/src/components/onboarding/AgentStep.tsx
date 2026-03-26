import { Server, Wifi, Activity } from 'lucide-react';

interface AgentStepProps {
  onNext: () => void;
  onSkip: () => void;
}

export default function AgentStep({ onNext, onSkip }: AgentStepProps) {
  return (
    <div className="w-full max-w-md animate-onboarding-slide-right text-center">
      <div className="flex items-center justify-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-xl bg-gray-800 flex items-center justify-center">
          <Server size={24} className="text-gray-400" />
        </div>
        <Wifi size={16} className="text-gray-600" />
        <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
          <Activity size={24} className="text-blue-400" />
        </div>
      </div>

      <h2 className="text-2xl font-bold text-gray-100 mb-2">Monitoring Agent</h2>
      <p className="text-gray-400 mb-6">
        Installiere den Agent auf deinen Servern für tiefere Einblicke:
        Systemmetriken, Prozess-Monitoring und lokale Health-Checks.
      </p>

      <div className="card p-4 mb-6 text-left">
        <p className="text-xs text-gray-500 mb-2">Installation auf dem Server:</p>
        <code className="block bg-gray-900 rounded-lg p-3 text-xs text-gray-300 font-mono select-all">
          curl -sSL https://cpi-control.dev/install.sh | bash
        </code>
      </div>

      <p className="text-xs text-gray-600 mb-8">
        Agents kannst du jederzeit unter Einstellungen &rarr; Agents einrichten.
      </p>

      <div className="flex items-center justify-center gap-3">
        <button onClick={onSkip} className="btn-ghost">
          Überspringen
        </button>
        <button onClick={onNext} className="btn-primary px-6">
          Setup abschließen
        </button>
      </div>
    </div>
  );
}
