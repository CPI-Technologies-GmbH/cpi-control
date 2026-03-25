import type { DiagnosticStep } from '@/types';
import { formatMs } from '@/lib/formatters';
import { ChevronDown, ChevronRight, Terminal } from 'lucide-react';
import { useState } from 'react';
import clsx from 'clsx';

interface Props {
  step: DiagnosticStep;
  index: number;
}

export default function FindingCard({ step, index }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-4 hover:bg-gray-800/30 transition-colors text-left"
      >
        <span className="w-6 h-6 rounded bg-gray-700 flex items-center justify-center text-xs text-gray-400 flex-shrink-0">
          {index + 1}
        </span>
        <Terminal size={14} className="text-blue-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-200">{step.tool}</p>
          <p className="text-xs text-gray-500">{formatMs(step.durationMs)}</p>
        </div>
        {expanded ? (
          <ChevronDown size={16} className="text-gray-500" />
        ) : (
          <ChevronRight size={16} className="text-gray-500" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-gray-700/50 p-4 space-y-3">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Input</p>
            <pre className="text-xs text-gray-300 bg-gray-900 rounded-lg p-3 overflow-x-auto">
              {JSON.stringify(step.input, null, 2)}
            </pre>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Output</p>
            <pre className="text-xs text-gray-300 bg-gray-900 rounded-lg p-3 overflow-x-auto max-h-64 overflow-y-auto">
              {JSON.stringify(step.output, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
