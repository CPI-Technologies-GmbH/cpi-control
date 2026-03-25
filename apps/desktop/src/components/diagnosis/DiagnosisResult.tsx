import type { DiagnosticRun } from '@/types';
import FindingCard from './FindingCard';
import { formatMs, formatDate, statusBgColor } from '@/lib/formatters';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Lightbulb,
  FileText,
  Zap,
  Clock,
  Brain,
} from 'lucide-react';
import clsx from 'clsx';

interface Props {
  run: DiagnosticRun;
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 size={20} className="text-emerald-400" />;
    case 'failed':
      return <XCircle size={20} className="text-red-400" />;
    case 'running':
      return <Loader2 size={20} className="text-blue-400 animate-spin" />;
    default:
      return null;
  }
}

export default function DiagnosisResult({ run }: Props) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <StatusIcon status={run.status} />
            <div>
              <p className="text-sm font-semibold text-gray-200">
                Diagnostic Run
              </p>
              <p className="text-xs text-gray-500">
                Trigger: {run.trigger} &middot; {formatDate(run.startedAt)}
              </p>
            </div>
          </div>
          <span className={clsx('badge', statusBgColor(run.status))}>
            {run.status}
          </span>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-6 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <Clock size={12} />
            {formatMs(run.durationMs)}
          </span>
          {run.tokensUsed && (
            <span className="flex items-center gap-1">
              <Brain size={12} />
              {run.tokensUsed.toLocaleString()} tokens
            </span>
          )}
          {run.steps && (
            <span className="flex items-center gap-1">
              <Zap size={12} />
              {run.steps.length} steps
            </span>
          )}
        </div>
      </div>

      {/* Summary */}
      {run.summary && (
        <div className="card p-4">
          <h3 className="text-sm font-medium text-gray-200 flex items-center gap-2 mb-2">
            <FileText size={14} />
            Summary
          </h3>
          <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
            {run.summary}
          </p>
        </div>
      )}

      {/* Recommendations */}
      {run.recommendations && run.recommendations.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-medium text-gray-200 flex items-center gap-2 mb-3">
            <Lightbulb size={14} className="text-amber-400" />
            Recommendations
          </h3>
          <ul className="space-y-2">
            {run.recommendations.map((rec, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <p className="text-sm text-gray-300">{rec}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Steps */}
      {run.steps && run.steps.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-200 mb-3">
            Diagnostic Steps ({run.steps.length})
          </h3>
          <div className="space-y-2">
            {run.steps.map((step, i) => (
              <FindingCard key={i} step={step} index={i} />
            ))}
          </div>
        </div>
      )}

      {/* Running state */}
      {run.status === 'running' && (
        <div className="card p-8 text-center">
          <Loader2 size={24} className="mx-auto text-blue-400 animate-spin mb-3" />
          <p className="text-sm text-gray-400">Diagnosis in progress...</p>
          <p className="text-xs text-gray-600 mt-1">This may take a few minutes</p>
        </div>
      )}
    </div>
  );
}
