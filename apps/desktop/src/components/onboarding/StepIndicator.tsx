import clsx from 'clsx';

interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
}

const STEP_LABELS = ['Willkommen', 'Integrationen', 'Synchronisation', 'Agent'];

export default function StepIndicator({ currentStep, totalSteps }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: totalSteps }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="flex flex-col items-center gap-1.5">
            <div
              className={clsx(
                'w-3 h-3 rounded-full transition-all duration-300',
                i < currentStep && 'bg-blue-500',
                i === currentStep && 'bg-blue-500 animate-pulse-ring',
                i > currentStep && 'bg-gray-700'
              )}
            />
            <span
              className={clsx(
                'text-[10px] font-medium transition-colors',
                i <= currentStep ? 'text-gray-300' : 'text-gray-600'
              )}
            >
              {STEP_LABELS[i]}
            </span>
          </div>
          {i < totalSteps - 1 && (
            <div
              className={clsx(
                'w-12 h-px mb-5 transition-colors duration-300',
                i < currentStep ? 'bg-blue-500' : 'bg-gray-700'
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}
