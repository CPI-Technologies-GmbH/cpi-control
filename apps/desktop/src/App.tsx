import { Routes, Route, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { settings } from '@/lib/api';
import { Loader2 } from 'lucide-react';
import MainLayout from '@/components/layout/MainLayout';
import OverviewGrid from '@/components/dashboard/OverviewGrid';
import ProjectList from '@/components/projects/ProjectList';
import ProjectDetail from '@/components/projects/ProjectDetail';
import ServiceList from '@/components/services/ServiceList';
import ServiceDetail from '@/components/services/ServiceDetail';
import DeploymentBoard from '@/components/deployments/DeploymentBoard';
import IncidentListPage from '@/components/incidents/IncidentList';
import IncidentDetail from '@/components/incidents/IncidentDetail';
import CronJobList from '@/components/cronjobs/CronJobList';
import LogViewer from '@/components/logs/LogViewer';
import LogLiveWindow from '@/components/logs/LogLiveWindow';
import AgentManagement from '@/components/agent/AgentManagement';
import Settings from '@/components/settings/Settings';
import OnboardingWizard from '@/components/onboarding/OnboardingWizard';

function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: settings.get,
    staleTime: Infinity,
  });

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-gray-950 flex items-center justify-center">
        <Loader2 size={24} className="text-blue-400 animate-spin" />
      </div>
    );
  }

  if (data && !data.onboardingCompleted) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      {/* Standalone live log window — no sidebar/header chrome */}
      <Route path="/logs/live" element={<LogLiveWindow />} />

      {/* Onboarding wizard — standalone, no guard */}
      <Route path="/onboarding" element={<OnboardingWizard />} />

      {/* All other routes wrapped in MainLayout + OnboardingGuard */}
      <Route
        path="*"
        element={
          <OnboardingGuard>
            <MainLayout>
              <Routes>
                <Route path="/" element={<OverviewGrid />} />
                <Route path="/projects" element={<ProjectList />} />
                <Route path="/projects/:id" element={<ProjectDetail />} />
                <Route path="/services" element={<ServiceList />} />
                <Route path="/services/:id" element={<ServiceDetail />} />
                <Route path="/deployments" element={<DeploymentBoard />} />
                <Route path="/cronjobs" element={<CronJobList />} />
                <Route path="/incidents" element={<IncidentListPage />} />
                <Route path="/incidents/:id" element={<IncidentDetail />} />
                <Route path="/logs" element={<LogViewer />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/settings/agent" element={<AgentManagement />} />
              </Routes>
            </MainLayout>
          </OnboardingGuard>
        }
      />
    </Routes>
  );
}
