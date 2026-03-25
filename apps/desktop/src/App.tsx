import { Routes, Route } from 'react-router-dom';
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

export default function App() {
  return (
    <Routes>
      {/* Standalone live log window — no sidebar/header chrome */}
      <Route path="/logs/live" element={<LogLiveWindow />} />

      {/* All other routes wrapped in MainLayout */}
      <Route
        path="*"
        element={
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
              <Route path="/agent" element={<AgentManagement />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </MainLayout>
        }
      />
    </Routes>
  );
}
