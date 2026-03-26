import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { settings } from '@/lib/api';
import StepIndicator from './StepIndicator';
import WelcomeStep from './WelcomeStep';
import IntegrationStep from './IntegrationStep';
import SyncStep from './SyncStep';
import AgentStep from './AgentStep';

const TOTAL_STEPS = 4;

export default function OnboardingWizard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [currentStep, setCurrentStep] = useState(0);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);

  const completeMutation = useMutation({
    mutationFn: () => settings.update({ onboardingCompleted: 'true' } as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      navigate('/');
    },
  });

  function next() {
    setCurrentStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }

  function completeOnboarding() {
    completeMutation.mutate();
  }

  const handleProvidersSaved = useCallback((providers: string[]) => {
    setConfiguredProviders(providers);
  }, []);

  return (
    <div className="fixed inset-0 bg-gray-950 z-50 flex flex-col">
      {/* Step indicator */}
      <div className="pt-8 pb-4">
        <StepIndicator currentStep={currentStep} totalSteps={TOTAL_STEPS} />
      </div>

      {/* Step content */}
      <div className="flex-1 flex items-center justify-center px-6 overflow-y-auto">
        <div key={currentStep} className="w-full flex justify-center">
          {currentStep === 0 && <WelcomeStep onNext={next} />}
          {currentStep === 1 && (
            <IntegrationStep
              onNext={next}
              onSkip={next}
              onProvidersSaved={handleProvidersSaved}
            />
          )}
          {currentStep === 2 && (
            <SyncStep
              configuredProviders={configuredProviders}
              onComplete={next}
            />
          )}
          {currentStep === 3 && (
            <AgentStep
              onNext={completeOnboarding}
              onSkip={completeOnboarding}
            />
          )}
        </div>
      </div>
    </div>
  );
}
