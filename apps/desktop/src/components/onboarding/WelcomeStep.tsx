import { Activity, Rocket, AlertTriangle, ScrollText } from 'lucide-react';

interface WelcomeStepProps {
  onNext: () => void;
}

const FEATURES = [
  { icon: Activity, label: 'Monitoring', desc: 'Alle Services im Blick behalten' },
  { icon: Rocket, label: 'Deployments', desc: 'Releases und CI/CD verfolgen' },
  { icon: AlertTriangle, label: 'Incidents', desc: 'Probleme sofort erkennen' },
  { icon: ScrollText, label: 'Logs', desc: 'Logs zentral durchsuchen' },
];

export default function WelcomeStep({ onNext }: WelcomeStepProps) {
  return (
    <div className="flex flex-col items-center text-center animate-onboarding-slide-right">
      <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-6">
        <Activity size={32} className="text-blue-400" />
      </div>

      <h1 className="text-3xl font-bold text-gray-100 mb-3">
        Willkommen bei CPI-Control
      </h1>
      <p className="text-gray-400 mb-10 max-w-md">
        Dein zentrales Dashboard für Services, Deployments und Monitoring.
        Lass uns in wenigen Schritten alles einrichten.
      </p>

      <div className="grid grid-cols-2 gap-4 mb-10 w-full max-w-md">
        {FEATURES.map((f, i) => (
          <div
            key={f.label}
            className="card p-4 flex flex-col items-center gap-2 opacity-0 animate-onboarding-fade-in"
            style={{ animationDelay: `${i * 120}ms` }}
          >
            <f.icon size={24} className="text-blue-400" />
            <span className="text-sm font-medium text-gray-200">{f.label}</span>
            <span className="text-xs text-gray-500">{f.desc}</span>
          </div>
        ))}
      </div>

      <button onClick={onNext} className="btn-primary text-base px-8 py-3">
        Los geht's
      </button>
    </div>
  );
}
