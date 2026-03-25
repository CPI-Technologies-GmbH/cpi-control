import { useState } from 'react';
import { useDiagnosticRuns, useDiagnosticRun, useTriggerDiagnosis } from '@/hooks/useDiagnosis';
import DiagnosisResult from './DiagnosisResult';
import { Stethoscope, Play, Loader2, Clock, ChevronRight } from 'lucide-react';
import { formatRelativeTime, statusBgColor } from '@/lib/formatters';
import clsx from 'clsx';

interface Props {
  serviceId: string;
  incidentId?: string;
}

export default function DiagnosisPanel({ serviceId, incidentId }: Props) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const { data: runs, isLoading: runsLoading } = useDiagnosticRuns(serviceId);
  const { data: selectedRun } = useDiagnosticRun(selectedRunId ?? undefined);
  const triggerMutation = useTriggerDiagnosis();

  function handleTrigger() {
    triggerMutation.mutate(
      { serviceId, incidentId },
      {
        onSuccess: (run) => {
          setSelectedRunId(run.id);
        },
      }
    );
  }

  return (
    <div className="space-y-6">
      {/* Trigger button */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          <Stethoscope size={16} />
          AI Diagnostics
        </h3>
        <button
          onClick={handleTrigger}
          disabled={triggerMutation.isPending}
          className="btn-primary flex items-center gap-2 text-sm"
        >
          {triggerMutation.isPending ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Starting...
            </>
          ) : (
            <>
              <Play size={14} />
              Run Diagnosis
            </>
          )}
        </button>
      </div>

      {triggerMutation.isError && (
        <div className="card p-4 text-sm text-red-400">
          Failed to trigger diagnosis. Please try again.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Run list */}
        <div className="lg:col-span-1">
          <h4 className="text-xs text-gray-500 uppercase tracking-wide mb-2">Previous Runs</h4>
          {runsLoading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="skeleton w-full h-14 rounded-lg" />
              ))}
            </div>
          )}
          {runs && runs.length === 0 && (
            <div className="card p-6 text-center text-sm text-gray-500">
              No diagnostic runs yet
            </div>
          )}
          {runs && runs.length > 0 && (
            <div className="space-y-1">
              {runs.map((run) => (
                <button
                  key={run.id}
                  onClick={() => setSelectedRunId(run.id)}
                  className={clsx(
                    'w-full card p-3 flex items-center gap-3 text-left transition-colors',
                    selectedRunId === run.id
                      ? 'border-blue-500/30 bg-blue-500/5'
                      : 'hover:bg-gray-800/30'
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={clsx('badge text-[10px]', statusBgColor(run.status))}>
                        {run.status}
                      </span>
                      <span className="text-[10px] text-gray-500">{run.trigger}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                      <Clock size={10} />
                      {formatRelativeTime(run.startedAt)}
                    </p>
                  </div>
                  <ChevronRight size={14} className="text-gray-600 flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Selected run detail */}
        <div className="lg:col-span-2">
          {selectedRun ? (
            <DiagnosisResult run={selectedRun} />
          ) : (
            <div className="card p-12 text-center text-sm text-gray-500">
              Select a diagnostic run to view details, or trigger a new one.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
