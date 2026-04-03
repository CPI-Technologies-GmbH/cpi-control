import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useService, useUpdateService } from '@/hooks/useServices';
import { useDeploymentsByService } from '@/hooks/useDeployments';
import { useIncidents } from '@/hooks/useIncidents';
import {
  useK8sDeployments,
  useK8sPods,
  useK8sPodMetrics,
  useK8sEvents,
  useRestartDeployment,
} from '@/hooks/useKubernetes';
import { useVercelProjectDetails } from '@/hooks/useVercel';
import { integrations as integrationsApi, infraBindings, repoBindings, deploymentSources as deploymentSourcesApi, monitoringTargets as monitoringTargetsApi } from '@/lib/api';
import ResponseTimeChart from './ResponseTimeChart';
import HealthTimeline from './HealthTimeline';
import DiagnosisPanel from '@/components/diagnosis/DiagnosisPanel';
import LogViewer from '@/components/logs/LogViewer';
import {
  statusBgColor,
  formatDate,
  formatRelativeTime,
  formatMs,
  deploymentStatusColor,
  severityColor,
} from '@/lib/formatters';
import {
  Globe,
  ExternalLink,
  Clock,
  Server,
  Lock,
  AlertTriangle,
  Rocket,
  ArrowLeft,
  Cpu,
  Stethoscope,
  Activity,
  Pencil,
  X,
  Check,
  ScrollText,
  Container,
  RefreshCw,
  Box,
  Circle,
  Triangle,
  GitBranch,
  Key,
  BarChart3,
  Database,
  Link2,
  Zap,
  Gauge,
  CheckCircle,
  XCircle,
  MemoryStick,
  Image,
  Archive,
  BellOff,
  Bell,
  Terminal,
} from 'lucide-react';
import { ProviderIcon } from '@/components/icons/ProviderIcons';
import clsx from 'clsx';
import type { Environment, HostingType, ServiceType, IntegrationConfig, VercelProjectDetails } from '@/types';

const environmentOptions: Environment[] = ['production', 'staging', 'development'];
const hostingTypeOptions: HostingType[] = [
  'vercel', 'kubernetes', 'digitalocean', 'aws', 'gcloud', 'azure', 'ovh', 'github', 'docker', 'other',
];
const typeOptions: { value: ServiceType; label: string }[] = [
  { value: 'website', label: 'Public' },
  { value: 'service', label: 'Private' },
];

type Tab = 'overview' | 'incidents' | 'deployments' | 'infrastructure' | 'k8s' | 'vercel' | 'diagnosis' | 'logs';

export default function ServiceDetail() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [isEditing, setIsEditing] = useState(false);
  const [showMuteMenu, setShowMuteMenu] = useState(false);
  const [showTerminalModal, setShowTerminalModal] = useState(false);
  const { data: service, isLoading, error } = useService(id);
  const { data: deployments } = useDeploymentsByService(id);
  const { data: incidents } = useIncidents(id ? { serviceId: id } : undefined);
  const updateService = useUpdateService();

  // Look up Kubernetes integration for K8s tab
  const { data: allIntegrations } = useQuery({
    queryKey: ['integrations'],
    queryFn: () => integrationsApi.list(),
  });
  const k8sIntegration = allIntegrations?.find(
    (i: IntegrationConfig) => i.provider === 'kubernetes' && i.enabled
  );
  const k8sIntegrationId = k8sIntegration?.id;

  // Look up Vercel integration for Vercel tab
  const vercelIntegration = allIntegrations?.find(
    (i: IntegrationConfig) => i.provider === 'vercel' && i.enabled
  );
  const vercelIntegrationId = vercelIntegration?.id;

  // Fetch infrastructure bindings for this service
  const { data: serviceInfraBindings } = useQuery({
    queryKey: ['infra-bindings', id],
    queryFn: () => infraBindings.list(id!),
    enabled: !!id,
  });

  // Fetch repository bindings, deployment sources, and monitoring targets for infrastructure tab
  const { data: serviceRepoBindings } = useQuery({
    queryKey: ['repo-bindings', id],
    queryFn: () => repoBindings.list(id!),
    enabled: !!id,
  });
  const { data: serviceDeploymentSources } = useQuery({
    queryKey: ['deployment-sources', id],
    queryFn: () => deploymentSourcesApi.list(id!),
    enabled: !!id,
  });
  const { data: serviceMonitoringTargets } = useQuery({
    queryKey: ['monitoring-targets', id],
    queryFn: () => monitoringTargetsApi.list(id!),
    enabled: !!id,
  });
  const k8sBinding = serviceInfraBindings?.find(
    (b) => b.provider === 'kubernetes' && b.resourceType === 'deployment'
  );

  // Parse K8s namespace and deployment name from infrastructure binding externalId
  // externalId format: "namespace/deploymentName" or just "deploymentName"
  const k8sNamespace = (() => {
    if (k8sBinding?.externalId) {
      const parts = k8sBinding.externalId.split('/');
      if (parts.length >= 2) return parts[0];
    }
    return (service?.metadata as Record<string, unknown> | null)?.namespace as string | undefined
      || service?.environment || 'default';
  })();
  const k8sDeploymentName = (() => {
    if (k8sBinding?.externalId) {
      const parts = k8sBinding.externalId.split('/');
      if (parts.length >= 2) return parts[parts.length - 1];
      return parts[0]; // no namespace prefix
    }
    return service?.name;
  })();
  // Extract cluster name from binding metadata to target the correct kubeconfig
  const k8sClusterName = (k8sBinding?.metadata as Record<string, unknown> | null)?.clusterName as string | undefined
    || (service?.metadata as Record<string, unknown> | null)?.clusterName as string | undefined;

  // K8s data hooks
  const k8sEnabled = service?.hostingType === 'kubernetes' ? k8sIntegrationId : undefined;
  const { data: k8sDeployments } = useK8sDeployments(k8sEnabled, k8sNamespace, k8sClusterName);
  const { data: k8sPods } = useK8sPods(k8sEnabled, k8sNamespace, k8sClusterName);
  const { data: k8sMetrics } = useK8sPodMetrics(k8sEnabled, k8sNamespace, k8sClusterName);
  const { data: k8sEvents } = useK8sEvents(k8sEnabled, k8sNamespace, undefined, k8sClusterName);
  const restartDeployment = useRestartDeployment();
  const [restartConfirm, setRestartConfirm] = useState(false);

  // Vercel binding and project details
  const vercelBinding = serviceInfraBindings?.find(
    (b) => b.provider === 'vercel' && b.resourceType === 'project'
  );
  const vercelProjectId = vercelBinding?.externalId || (
    service?.hostingType === 'vercel' ? service?.name : undefined
  );

  // Fetch Vercel project details when service is Vercel-hosted
  const isVercel = service?.hostingType === 'vercel';
  const { data: vercelDetails, isLoading: vercelLoading } = useVercelProjectDetails(
    isVercel ? vercelIntegrationId : undefined,
    vercelProjectId
  );

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editEnvironment, setEditEnvironment] = useState<Environment>('production');
  const [editHostingType, setEditHostingType] = useState<HostingType>('other');
  const [editType, setEditType] = useState<ServiceType>('website');
  const [editUrl, setEditUrl] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editPublicName, setEditPublicName] = useState('');
  const [editPublicDescription, setEditPublicDescription] = useState('');
  const [showStatusPageSettings, setShowStatusPageSettings] = useState(false);

  function openEditForm() {
    if (!service) return;
    setEditName(service.name);
    setEditEnvironment(service.environment);
    setEditHostingType(service.hostingType);
    setEditType(service.type);
    setEditUrl(service.url || '');
    setEditTags(service.tags?.join(', ') || '');
    setEditPublicName(service.publicName || '');
    setEditPublicDescription(service.publicDescription || '');
    setShowStatusPageSettings(!!(service.publicName || service.publicDescription));
    setIsEditing(true);
  }

  function cancelEdit() {
    setIsEditing(false);
  }

  async function saveEdit() {
    if (!service) return;
    const tagsArray = editTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    await updateService.mutateAsync({
      id: service.id,
      data: {
        name: editName,
        environment: editEnvironment,
        hostingType: editHostingType,
        type: editType,
        url: editUrl || undefined,
        tags: tagsArray.length > 0 ? tagsArray : [],
        publicName: editPublicName.trim() || null,
        publicDescription: editPublicDescription.trim() || null,
      },
    });
    setIsEditing(false);
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="skeleton w-64 h-8 rounded" />
        <div className="skeleton w-full h-48 rounded-lg" />
        <div className="skeleton w-full h-64 rounded-lg" />
      </div>
    );
  }

  if (error || !service) {
    return (
      <div className="card p-8 text-center">
        <p className="text-red-400 mb-4">
          {error ? 'Failed to load service details' : 'Service not found'}
        </p>
        <Link to="/" className="btn-secondary text-sm">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  const isWebsite = service.type === 'website';

  const isK8s = service.hostingType === 'kubernetes';

  const tabs: { key: Tab; label: string; icon: React.ReactNode; hidden?: boolean }[] = [
    { key: 'overview', label: 'Overview', icon: isWebsite ? <Globe size={14} /> : <Server size={14} /> },
    { key: 'incidents', label: 'Incidents', icon: <AlertTriangle size={14} /> },
    { key: 'deployments', label: 'Deployments', icon: <Rocket size={14} /> },
    { key: 'infrastructure', label: 'Infrastructure', icon: <Server size={14} /> },
    { key: 'k8s', label: 'K8s', icon: <Container size={14} />, hidden: !isK8s },
    { key: 'vercel', label: 'Vercel', icon: <Triangle size={14} />, hidden: !isVercel },
    { key: 'diagnosis', label: 'Diagnosis', icon: <Stethoscope size={14} /> },
    { key: 'logs', label: 'Logs', icon: <ScrollText size={14} /> },
  ];

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link to="/services" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors">
        <ArrowLeft size={16} />
        Back to Services
      </Link>

      {/* Edit Form */}
      {isEditing && (
        <div className="card p-6 border border-blue-500/30">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold text-gray-200">Edit Service</h2>
            <button onClick={cancelEdit} className="text-gray-500 hover:text-gray-300 transition-colors">
              <X size={16} />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Name */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="input w-full py-2 text-sm"
              />
            </div>
            {/* Environment */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Environment</label>
              <select
                value={editEnvironment}
                onChange={(e) => setEditEnvironment(e.target.value as Environment)}
                className="input w-full py-2 text-sm"
              >
                {environmentOptions.map((env) => (
                  <option key={env} value={env}>{env}</option>
                ))}
              </select>
            </div>
            {/* Hosting Type */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Hosting Type</label>
              <select
                value={editHostingType}
                onChange={(e) => setEditHostingType(e.target.value as HostingType)}
                className="input w-full py-2 text-sm"
              >
                {hostingTypeOptions.map((ht) => (
                  <option key={ht} value={ht}>{ht}</option>
                ))}
              </select>
            </div>
            {/* Type (Public/Private) */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Type</label>
              <select
                value={editType}
                onChange={(e) => setEditType(e.target.value as ServiceType)}
                className="input w-full py-2 text-sm"
              >
                {typeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            {/* URL */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">URL (optional)</label>
              <input
                type="text"
                value={editUrl}
                onChange={(e) => setEditUrl(e.target.value)}
                placeholder="https://example.com"
                className="input w-full py-2 text-sm"
              />
            </div>
            {/* Tags */}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Tags (comma-separated)</label>
              <input
                type="text"
                value={editTags}
                onChange={(e) => setEditTags(e.target.value)}
                placeholder="frontend, critical, ..."
                className="input w-full py-2 text-sm"
              />
            </div>
          </div>

          {/* Status Page Settings (collapsible) */}
          <div className="mt-4 border border-gray-700/50 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setShowStatusPageSettings(!showStatusPageSettings)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-gray-400 hover:text-gray-300 hover:bg-gray-800/50 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Globe size={12} />
                Status Page Settings
              </span>
              <span className="text-gray-600">{showStatusPageSettings ? '\u25B2' : '\u25BC'}</span>
            </button>
            {showStatusPageSettings && (
              <div className="px-4 pb-4 pt-2 grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-gray-700/50">
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">Public Name</label>
                  <input
                    type="text"
                    value={editPublicName}
                    onChange={(e) => setEditPublicName(e.target.value)}
                    placeholder="Display name for status page"
                    className="input w-full py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5">Public Description</label>
                  <input
                    type="text"
                    value={editPublicDescription}
                    onChange={(e) => setEditPublicDescription(e.target.value)}
                    placeholder="Brief description for status page"
                    className="input w-full py-2 text-sm"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 mt-5">
            <button
              onClick={saveEdit}
              disabled={updateService.isPending || !editName.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check size={14} />
              {updateService.isPending ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              onClick={cancelEdit}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
            >
              Cancel
            </button>
            {updateService.isError && (
              <span className="text-xs text-red-400">Failed to save changes</span>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-gray-100">{service.name}</h1>
            <span className={clsx('badge', statusBgColor(service.status))}>
              {service.status}
            </span>
            <span className={clsx(
              'badge text-[10px]',
              isWebsite
                ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
            )}>
              {isWebsite ? (<span className="flex items-center gap-1"><Globe size={10} /> Public Service</span>) : (<span className="flex items-center gap-1"><Lock size={10} /> Private Service</span>)}
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-400">
            <span>{service.projectName || 'No project'}</span>
            {isWebsite && service.url && (
              <>
                <span className="text-gray-700">|</span>
                <a
                  href={service.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 hover:text-blue-400 transition-colors"
                >
                  {service.url}
                  <ExternalLink size={12} />
                </a>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {!isEditing && (
            <>
              <button
                onClick={openEditForm}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors border border-gray-700"
              >
                <Pencil size={14} />
                Edit
              </button>

              {/* Mute button */}
              <div className="relative">
                {service.mutedUntil && (service.mutedUntil === 'forever' || new Date(service.mutedUntil) > new Date()) ? (
                  <button
                    onClick={() => updateService.mutate({ id: service.id, data: { mutedUntil: null } })}
                    disabled={updateService.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                  >
                    <Bell size={14} />
                    Unmute
                  </button>
                ) : (
                  <button
                    onClick={() => setShowMuteMenu(!showMuteMenu)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors border border-gray-700"
                  >
                    <BellOff size={14} />
                    Mute
                  </button>
                )}
                {showMuteMenu && (
                  <div className="absolute top-full mt-1 right-0 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 py-1 min-w-[120px]">
                    {[
                      { label: '1 Stunde', hours: 1 },
                      { label: '12 Stunden', hours: 12 },
                      { label: '1 Tag', hours: 24 },
                      { label: '7 Tage', hours: 24 * 7 },
                      { label: 'Permanent', hours: -1 },
                    ].map((opt) => (
                      <button
                        key={opt.hours}
                        onClick={() => {
                          const mutedUntil = opt.hours === -1
                            ? 'forever'
                            : new Date(Date.now() + opt.hours * 60 * 60 * 1000).toISOString();
                          setShowMuteMenu(false);
                          updateService.mutate({ id: service.id, data: { mutedUntil } });
                        }}
                        className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 transition-colors"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Archive button */}
              {!service.archived ? (
                <button
                  onClick={() => {
                    updateService.mutate(
                      { id: service.id, data: { archived: true } },
                      { onSuccess: () => window.history.back() }
                    );
                  }}
                  disabled={updateService.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors border border-gray-700 disabled:opacity-50"
                >
                  <Archive size={14} />
                  Archive
                </button>
              ) : (
                <button
                  onClick={() => {
                    updateService.mutate({ id: service.id, data: { archived: false } });
                  }}
                  disabled={updateService.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 transition-colors disabled:opacity-50"
                >
                  <Archive size={14} />
                  Unarchive
                </button>
              )}
              {/* Open Terminal (K8s only) */}
              {service.hostingType === 'kubernetes' && k8sNamespace && (
                <button
                  onClick={() => setShowTerminalModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors border border-gray-700"
                >
                  <Terminal size={14} />
                  Terminal
                </button>
              )}
            </>
          )}
          {isWebsite && (
            <>
              <div className="text-right">
                <p className="text-gray-500">Last Check</p>
                <p className="text-gray-300">{formatRelativeTime(service.lastCheckedAt)}</p>
              </div>
              <div className="text-right">
                <p className="text-gray-500">Response</p>
                <p className="text-gray-300 font-mono">{formatMs(service.lastResponseTimeMs)}</p>
              </div>
            </>
          )}
          {!isWebsite && (
            <div className="text-right">
              <p className="text-gray-500">Provider Status</p>
              <p className="text-gray-300 flex items-center gap-1.5">
                <Activity size={12} />
                {service.status}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-6 border-b border-gray-800 pb-0">
        {tabs.filter((tab) => !tab.hidden).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={clsx(
              'flex items-center gap-1.5 pb-3 text-sm font-medium transition-colors',
              activeTab === tab.key ? 'tab-active' : 'tab-inactive'
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Quick info cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="card p-4">
              <p className="text-xs text-gray-500 mb-1">Environment</p>
              <p className="text-sm font-medium text-gray-200">{service.environment}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-gray-500 mb-1">Hosting</p>
              <p className="text-sm font-medium text-gray-200 flex items-center gap-1.5">
                <ProviderIcon provider={service.hostingType} size={14} />
                {service.hostingType}
              </p>
            </div>
            {isWebsite && (
              <>
                <div className="card p-4">
                  <p className="text-xs text-gray-500 mb-1">Check Interval</p>
                  <p className="text-sm font-medium text-gray-200">
                    {service.checkIntervalSeconds ?? 60}s
                  </p>
                </div>
                <div className="card p-4">
                  <p className="text-xs text-gray-500 mb-1">Expected Status</p>
                  <p className="text-sm font-medium text-gray-200">
                    {service.expectedStatusCode ?? 200}
                  </p>
                </div>
              </>
            )}
            {!isWebsite && (
              <>
                <div className="card p-4">
                  <p className="text-xs text-gray-500 mb-1">Type</p>
                  <p className="text-sm font-medium text-gray-200">Private Service</p>
                </div>
                <div className="card p-4">
                  <p className="text-xs text-gray-500 mb-1">Status</p>
                  <p className="text-sm font-medium text-gray-200">{service.status}</p>
                </div>
              </>
            )}
          </div>

          {/* Response time chart (websites only) */}
          {isWebsite && (
            <div className="card p-4">
              <ResponseTimeChart serviceId={service.id} />
            </div>
          )}

          {/* Provider status info (services only) */}
          {!isWebsite && (
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2 mb-3">
                <Activity size={14} />
                Provider Status
              </h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">Hosting Provider</p>
                  <p className="text-gray-200 font-medium flex items-center gap-1.5">
                    <ProviderIcon provider={service.hostingType} size={14} />
                    {service.hostingType}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Current Status</p>
                  <p className={clsx(
                    'font-medium',
                    service.status === 'healthy' ? 'text-emerald-400' :
                    service.status === 'degraded' ? 'text-amber-400' :
                    service.status === 'down' ? 'text-red-400' : 'text-gray-400'
                  )}>
                    {service.status}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Health timeline (websites only) */}
          {isWebsite && (
            <div className="card">
              <div className="p-4 border-b border-gray-700/50">
                <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                  <Clock size={14} />
                  Health Timeline
                </h3>
              </div>
              <HealthTimeline serviceId={service.id} />
            </div>
          )}

          {/* Tags */}
          {service.tags && service.tags.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-400 mb-2">Tags</h3>
              <div className="flex flex-wrap gap-2">
                {service.tags.map((tag) => (
                  <span key={tag} className="badge bg-gray-700/50 text-gray-400 border-gray-600/50">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'incidents' && (
        <div className="space-y-3">
          {(!incidents || incidents.length === 0) && (
            <div className="card p-8 text-center text-sm text-gray-500">
              No incidents for this service
            </div>
          )}
          {incidents?.map((inc) => (
            <Link
              key={inc.id}
              to={`/incidents/${inc.id}`}
              className="card-hover p-4 block"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <AlertTriangle
                    size={16}
                    className={
                      inc.severity === 'critical'
                        ? 'text-red-400'
                        : inc.severity === 'warning'
                          ? 'text-amber-400'
                          : 'text-blue-400'
                    }
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-200">{inc.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={clsx('badge text-[10px]', severityColor(inc.severity))}>
                        {inc.severity}
                      </span>
                      <span className={clsx('badge text-[10px]', statusBgColor(inc.status))}>
                        {inc.status}
                      </span>
                    </div>
                  </div>
                </div>
                <span className="text-xs text-gray-500">
                  {formatRelativeTime(inc.detectedAt)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {activeTab === 'deployments' && (
        <div className="space-y-3">
          {(!deployments || deployments.length === 0) && (
            <div className="card p-8 text-center text-sm text-gray-500">
              No deployments for this service
            </div>
          )}
          {deployments?.map((dep) => (
            <div key={dep.id} className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <Rocket size={16} className="text-gray-500" />
                  <div>
                    <p className="text-sm font-medium text-gray-200">
                      {dep.commitMessage
                        ? dep.commitMessage.split('\n')[0].slice(0, 60)
                        : dep.externalId}
                    </p>
                    <p className="text-xs text-gray-500">
                      {dep.branch || '\u2014'} &middot; {dep.author || '\u2014'}
                    </p>
                  </div>
                </div>
                <span className={clsx('badge', deploymentStatusColor(dep.status))}>
                  {dep.status}
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <ProviderIcon provider={dep.provider} size={12} />
                  {dep.provider}
                </span>
                <span>{formatRelativeTime(dep.startedAt)}</span>
                {dep.buildDurationMs && (
                  <span>Build: {formatMs(dep.buildDurationMs)}</span>
                )}
                {dep.commitSha && (
                  <span className="font-mono">{dep.commitSha.slice(0, 7)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'infrastructure' && (
        <div className="space-y-6">
          {/* Hosting */}
          <div className="card p-6">
            <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2 mb-4">
              <Server size={16} />
              Hosting
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs text-gray-500 mb-1">Provider</p>
                <p className="text-gray-200 font-medium flex items-center gap-1.5">
                  <ProviderIcon provider={service.hostingType} size={14} />
                  {service.hostingType}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Type</p>
                <p className="text-gray-200 font-medium flex items-center gap-1.5">
                  {isWebsite ? (
                    <><Globe size={12} className="text-blue-400" /> Public Service</>
                  ) : (
                    <><Lock size={12} className="text-purple-400" /> Private Service</>
                  )}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Environment</p>
                <p className="text-gray-200 font-medium">{service.environment}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">URL</p>
                {service.url ? (
                  <a
                    href={service.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1 truncate"
                  >
                    {service.url.replace(/^https?:\/\//, '')}
                    <ExternalLink size={12} className="flex-shrink-0" />
                  </a>
                ) : (
                  <p className="text-gray-600">No URL</p>
                )}
              </div>
              {(service.metadata as any)?.clusterName && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">Cluster</p>
                  <p className="text-gray-200 font-medium">{(service.metadata as any).clusterName}</p>
                </div>
              )}
            </div>
          </div>

          {/* Git Repository */}
          <div className="card p-6">
            <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2 mb-4">
              <GitBranch size={16} />
              Git Repository
            </h3>
            {(!serviceRepoBindings || serviceRepoBindings.length === 0) ? (
              <p className="text-sm text-gray-600">No repository bindings configured</p>
            ) : (
              <div className="space-y-3">
                {serviceRepoBindings.map((rb) => (
                  <div key={rb.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-800/50 border border-gray-700/50">
                    <div className="flex items-center gap-3 min-w-0">
                      <ProviderIcon provider={rb.provider} size={16} />
                      <div className="min-w-0">
                        <a
                          href={`https://github.com/${rb.owner}/${rb.repo}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
                        >
                          {rb.owner}/{rb.repo}
                          <ExternalLink size={12} />
                        </a>
                        <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                          {rb.defaultBranch && (
                            <a
                              href={`https://github.com/${rb.owner}/${rb.repo}/tree/${rb.defaultBranch}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 font-mono hover:text-gray-400 transition-colors"
                            >
                              <GitBranch size={10} />
                              {rb.defaultBranch}
                            </a>
                          )}
                          <span className="capitalize">{rb.provider}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Infrastructure Bindings */}
          <div className="card p-6">
            <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2 mb-4">
              <Database size={16} />
              Infrastructure Bindings
            </h3>
            {(!serviceInfraBindings || serviceInfraBindings.length === 0) ? (
              <p className="text-sm text-gray-600">No infrastructure bindings configured</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-gray-700/50">
                      <th className="text-left py-2 pr-4 font-medium">Provider</th>
                      <th className="text-left py-2 pr-4 font-medium">External ID</th>
                      <th className="text-left py-2 pr-4 font-medium">Resource Type</th>
                      <th className="text-left py-2 pr-4 font-medium">Region</th>
                    </tr>
                  </thead>
                  <tbody>
                    {serviceInfraBindings.map((ib) => (
                      <tr key={ib.id} className="border-b border-gray-800/50">
                        <td className="py-2.5 pr-4">
                          <span className="flex items-center gap-1.5 text-gray-200">
                            <ProviderIcon provider={ib.provider} size={14} />
                            {ib.provider}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-gray-300 text-xs">{ib.externalId}</td>
                        <td className="py-2.5 pr-4">
                          {ib.resourceType ? (
                            <span className="badge bg-gray-700/50 text-gray-400 border-gray-600/50 text-[10px]">
                              {ib.resourceType}
                            </span>
                          ) : (
                            <span className="text-gray-600">&mdash;</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4 text-gray-400">{ib.region || '\u2014'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Deployment Sources */}
          <div className="card p-6">
            <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2 mb-4">
              <Zap size={16} />
              Deployment Sources
            </h3>
            {(!serviceDeploymentSources || serviceDeploymentSources.length === 0) ? (
              <p className="text-sm text-gray-600">No deployment sources configured</p>
            ) : (
              <div className="space-y-2">
                {serviceDeploymentSources.map((ds) => (
                  <div key={ds.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-800/50 border border-gray-700/50">
                    <div className="flex items-center gap-3">
                      <ProviderIcon provider={ds.provider} size={16} />
                      <div>
                        <p className="text-sm font-medium text-gray-200 capitalize">{ds.provider}</p>
                        {ds.pipelineName && (
                          <p className="text-xs text-gray-500 mt-0.5">{ds.pipelineName}</p>
                        )}
                        {ds.externalProjectId && (
                          <p className="text-xs text-gray-600 font-mono mt-0.5">{ds.externalProjectId}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {ds.autoDeploy ? (
                        <span className="badge text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20 flex items-center gap-1">
                          <CheckCircle size={10} />
                          Auto-deploy
                        </span>
                      ) : (
                        <span className="badge text-[10px] bg-gray-700/50 text-gray-500 border-gray-600/50 flex items-center gap-1">
                          <XCircle size={10} />
                          Manual
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Monitoring Config */}
          <div className="card p-6">
            <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2 mb-4">
              <Gauge size={16} />
              Monitoring Config
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm mb-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">Check Interval</p>
                <p className="text-gray-200 font-medium">
                  {service.checkIntervalSeconds ?? 60}s
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Expected Status Code</p>
                <p className="text-gray-200 font-medium font-mono">
                  {service.expectedStatusCode ?? 200}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Health Check URL</p>
                {(service.healthCheckUrl || service.url) ? (
                  <a
                    href={service.healthCheckUrl || service.url || ''}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1 truncate text-xs"
                  >
                    {(service.healthCheckUrl || service.url || '').replace(/^https?:\/\//, '')}
                    <ExternalLink size={10} className="flex-shrink-0" />
                  </a>
                ) : (
                  <p className="text-gray-600">Not configured</p>
                )}
              </div>
            </div>

            {/* Monitoring targets detail */}
            {serviceMonitoringTargets && serviceMonitoringTargets.length > 0 && (
              <div className="border-t border-gray-700/50 pt-4">
                <p className="text-xs text-gray-500 mb-3">Active Monitoring Targets</p>
                <div className="space-y-2">
                  {serviceMonitoringTargets.map((mt) => (
                    <div key={mt.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-800/50 border border-gray-700/50">
                      <div className="min-w-0">
                        <p className="text-sm font-mono text-gray-200 truncate">{mt.target}</p>
                        <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                          <span className="capitalize">{mt.type}</span>
                          <span>Interval: {mt.checkIntervalSeconds ?? 60}s</span>
                          <span>Timeout: {mt.timeoutMs ?? 10000}ms</span>
                          {mt.expectedStatusCode && (
                            <span>Expected: {mt.expectedStatusCode}</span>
                          )}
                        </div>
                      </div>
                      <span className={clsx(
                        'badge text-[10px]',
                        mt.enabled
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : 'bg-gray-700/50 text-gray-500 border-gray-600/50'
                      )}>
                        {mt.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'k8s' && isK8s && (
        <div className="space-y-6">
          {/* Deployment Info */}
          {(() => {
            // Match K8s deployment: try exact name match first, then fall back
            // to suffix match (K8s deployments are often prefixed with the namespace,
            // e.g. service "invoices-dev" -> deployment "vacabee-invoices-dev")
            const matchingDep = k8sDeployments?.find(
              (d) => d.name === k8sDeploymentName
            ) || k8sDeployments?.find(
              (d) => k8sDeploymentName && d.name.endsWith(`-${k8sDeploymentName}`)
            );
            const depName = matchingDep?.name || k8sDeploymentName || '__none__';
            const matchingPods = k8sPods?.filter(
              (p) => p.name.startsWith(depName)
            ) || [];

            // Helper: parse K8s CPU quantity (e.g. "12m", "0", "1500n", "2") to millicores
            const parseCpuMillicores = (cpu: string): number => {
              if (!cpu || cpu === '0') return 0;
              if (cpu.endsWith('n')) return parseInt(cpu) / 1_000_000;
              if (cpu.endsWith('m')) return parseInt(cpu);
              return parseFloat(cpu) * 1000;
            };

            // Helper: parse K8s memory quantity (e.g. "64Mi", "128974848", "1Gi") to MiB
            const parseMemoryMiB = (mem: string): number => {
              if (!mem || mem === '0') return 0;
              if (mem.endsWith('Ki')) return parseInt(mem) / 1024;
              if (mem.endsWith('Mi')) return parseInt(mem);
              if (mem.endsWith('Gi')) return parseInt(mem) * 1024;
              if (mem.endsWith('Ti')) return parseInt(mem) * 1024 * 1024;
              return parseInt(mem) / (1024 * 1024);
            };

            // Helper: format CPU for display
            const formatCpu = (cpu: string): string => {
              const mc = parseCpuMillicores(cpu);
              if (mc >= 1000) return `${(mc / 1000).toFixed(1)} cores`;
              return `${Math.round(mc)}m`;
            };

            // Helper: format memory for display
            const formatMemory = (mem: string): string => {
              const mib = parseMemoryMiB(mem);
              if (mib >= 1024) return `${(mib / 1024).toFixed(1)} GiB`;
              return `${Math.round(mib)} MiB`;
            };

            // Get metrics for matching pods
            const metricsAvailable = k8sMetrics?.available === true;
            const podMetricsMap = new Map(
              (k8sMetrics?.pods || []).map((m) => [m.name, m])
            );

            // Collect unique container images from matching pods
            const containerImages = new Map<string, { name: string; image: string; tag: string }>();
            for (const pod of matchingPods) {
              for (const container of pod.containers) {
                if (!containerImages.has(container.image)) {
                  const parts = container.image.split(':');
                  containerImages.set(container.image, {
                    name: container.name,
                    image: parts[0],
                    tag: parts[1] || 'latest',
                  });
                }
              }
            }

            // Filter events for this deployment's pods
            const podNames = new Set(matchingPods.map((p) => p.name));
            const deploymentEvents = (k8sEvents || [])
              .filter((e) => podNames.has(e.involvedObject.name) || e.involvedObject.name === depName)
              .sort((a, b) => {
                const aTime = a.lastTimestamp || a.firstTimestamp;
                const bTime = b.lastTimestamp || b.firstTimestamp;
                return new Date(bTime).getTime() - new Date(aTime).getTime();
              });

            return (
              <>
                {/* K8s Deployment Status */}
                <div className="card p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                      <Box size={16} />
                      Deployment: {depName !== '__none__' ? depName : k8sDeploymentName}
                    </h3>
                    {k8sIntegrationId && matchingDep && (
                      <div className="flex items-center gap-2">
                        {restartConfirm ? (
                          <>
                            <span className="text-xs text-amber-400">Confirm restart?</span>
                            <button
                              onClick={() => {
                                restartDeployment.mutate({
                                  integrationId: k8sIntegrationId,
                                  namespace: k8sNamespace || 'default',
                                  name: matchingDep.name,
                                  clusterName: k8sClusterName,
                                });
                                setRestartConfirm(false);
                              }}
                              disabled={restartDeployment.isPending}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50"
                            >
                              <Check size={12} />
                              Yes, Restart
                            </button>
                            <button
                              onClick={() => setRestartConfirm(false)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setRestartConfirm(true)}
                            disabled={restartDeployment.isPending}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-600/30 transition-colors disabled:opacity-50"
                          >
                            <RefreshCw size={12} className={restartDeployment.isPending ? 'animate-spin' : ''} />
                            {restartDeployment.isPending ? 'Restarting...' : 'Restart Deployment'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {restartDeployment.isSuccess && (
                    <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400">
                      Rolling restart initiated successfully. Pods will be recreated.
                    </div>
                  )}
                  {restartDeployment.isError && (
                    <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                      Failed to restart deployment: {(restartDeployment.error as Error)?.message}
                    </div>
                  )}

                  {matchingDep ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-gray-500">Namespace</p>
                        <p className="text-gray-200 font-medium font-mono">{matchingDep.namespace}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">Replicas</p>
                        <p className="text-gray-200 font-medium">
                          <span className={clsx(
                            matchingDep.readyReplicas >= matchingDep.replicas ? 'text-emerald-400' :
                            matchingDep.readyReplicas > 0 ? 'text-amber-400' : 'text-red-400'
                          )}>
                            {matchingDep.readyReplicas}
                          </span>
                          {' / '}
                          {matchingDep.replicas} ready
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500">Available</p>
                        <p className="text-gray-200 font-medium">{matchingDep.availableReplicas}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">Updated</p>
                        <p className="text-gray-200 font-medium">{matchingDep.updatedReplicas}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">
                      {k8sDeployments === undefined
                        ? 'Loading deployment info...'
                        : `No matching deployment found for "${k8sDeploymentName}" in namespace "${k8sNamespace}"`}
                    </p>
                  )}

                  {/* Conditions */}
                  {matchingDep && matchingDep.conditions.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs text-gray-500 mb-2">Conditions</p>
                      <div className="space-y-1">
                        {matchingDep.conditions.map((cond, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <Circle
                              size={8}
                              className={clsx(
                                'fill-current',
                                cond.status === 'True' ? 'text-emerald-400' : 'text-gray-600'
                              )}
                            />
                            <span className="text-gray-400 font-medium">{cond.type}</span>
                            {cond.reason && (
                              <span className="text-gray-600">- {cond.reason}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Resource Usage (Metrics) */}
                <div className="card p-6">
                  <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2 mb-4">
                    <Activity size={16} />
                    Resource Usage
                  </h3>
                  {k8sMetrics === undefined && (
                    <p className="text-sm text-gray-500">Loading metrics...</p>
                  )}
                  {k8sMetrics && !metricsAvailable && (
                    <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/50">
                      <div className="flex items-center gap-2 text-sm text-gray-400">
                        <AlertTriangle size={14} className="text-amber-400 flex-shrink-0" />
                        <span>Metrics not available. Install <span className="font-mono text-gray-300">metrics-server</span> in your cluster to see CPU and memory usage.</span>
                      </div>
                    </div>
                  )}
                  {metricsAvailable && matchingPods.length > 0 && (
                    <div className="space-y-3">
                      {matchingPods.map((pod) => {
                        const metrics = podMetricsMap.get(pod.name);
                        if (!metrics) return (
                          <div key={pod.name} className="p-3 rounded-lg bg-gray-800/50 border border-gray-700/50">
                            <p className="text-xs font-mono text-gray-400 truncate">{pod.name}</p>
                            <p className="text-xs text-gray-600 mt-1">No metrics data</p>
                          </div>
                        );

                        // Aggregate CPU/memory across all containers
                        let totalCpuMc = 0;
                        let totalMemMiB = 0;
                        for (const c of metrics.containers) {
                          totalCpuMc += parseCpuMillicores(c.cpu);
                          totalMemMiB += parseMemoryMiB(c.memory);
                        }

                        return (
                          <div key={pod.name} className="p-3 rounded-lg bg-gray-800/50 border border-gray-700/50">
                            <div className="flex items-center justify-between mb-3">
                              <p className="text-xs font-mono text-gray-300 truncate">{pod.name}</p>
                              <span className={clsx(
                                'badge text-[10px]',
                                pod.status === 'Running' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                pod.status === 'Pending' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                                'bg-red-500/10 text-red-400 border-red-500/20'
                              )}>
                                {pod.status}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              {/* CPU */}
                              <div>
                                <div className="flex items-center justify-between text-xs mb-1">
                                  <span className="text-gray-500 flex items-center gap-1">
                                    <Cpu size={10} />
                                    CPU
                                  </span>
                                  <span className="text-gray-300 font-mono">{formatCpu(String(totalCpuMc) + 'm')}</span>
                                </div>
                                <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                  <div
                                    className={clsx(
                                      'h-full rounded-full transition-all',
                                      totalCpuMc < 500 ? 'bg-emerald-500' :
                                      totalCpuMc < 800 ? 'bg-amber-500' : 'bg-red-500'
                                    )}
                                    style={{ width: `${Math.min(100, (totalCpuMc / 1000) * 100)}%` }}
                                  />
                                </div>
                              </div>
                              {/* Memory */}
                              <div>
                                <div className="flex items-center justify-between text-xs mb-1">
                                  <span className="text-gray-500 flex items-center gap-1">
                                    <MemoryStick size={10} />
                                    Memory
                                  </span>
                                  <span className="text-gray-300 font-mono">{formatMemory(String(Math.round(totalMemMiB)) + 'Mi')}</span>
                                </div>
                                <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                  <div
                                    className={clsx(
                                      'h-full rounded-full transition-all',
                                      totalMemMiB < 256 ? 'bg-emerald-500' :
                                      totalMemMiB < 512 ? 'bg-amber-500' : 'bg-red-500'
                                    )}
                                    style={{ width: `${Math.min(100, (totalMemMiB / 1024) * 100)}%` }}
                                  />
                                </div>
                              </div>
                            </div>
                            {/* Per-container breakdown if multiple containers */}
                            {metrics.containers.length > 1 && (
                              <div className="mt-2 pt-2 border-t border-gray-700/50">
                                <p className="text-[10px] text-gray-600 mb-1">Per container</p>
                                <div className="space-y-1">
                                  {metrics.containers.map((c) => (
                                    <div key={c.name} className="flex items-center justify-between text-[10px]">
                                      <span className="text-gray-500 font-mono">{c.name}</span>
                                      <span className="text-gray-400">
                                        {formatCpu(c.cpu)} / {formatMemory(c.memory)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {metricsAvailable && matchingPods.length === 0 && (
                    <p className="text-sm text-gray-500">No pods to display metrics for</p>
                  )}
                </div>

                {/* Pods List */}
                <div className="card p-6">
                  <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2 mb-4">
                    <Container size={16} />
                    Pods ({matchingPods.length})
                  </h3>
                  {matchingPods.length === 0 && (
                    <p className="text-sm text-gray-500">
                      {k8sPods === undefined ? 'Loading pods...' : 'No pods found for this deployment'}
                    </p>
                  )}
                  {matchingPods.length > 0 && (
                    <div className="space-y-2">
                      {matchingPods.map((pod) => (
                        <div
                          key={pod.name}
                          className="p-3 rounded-lg bg-gray-800/50 border border-gray-700/50"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 min-w-0">
                              <Circle
                                size={8}
                                className={clsx(
                                  'flex-shrink-0 fill-current',
                                  pod.status === 'Running' ? 'text-emerald-400' :
                                  pod.status === 'Pending' ? 'text-amber-400' :
                                  pod.status === 'Succeeded' ? 'text-blue-400' :
                                  'text-red-400'
                                )}
                              />
                              <div className="min-w-0">
                                <p className="text-sm font-mono text-gray-200 truncate">{pod.name}</p>
                                <p className="text-xs text-gray-500">
                                  Node: {pod.nodeName || 'N/A'} | Restarts: {pod.restartCount}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              <span className={clsx(
                                'badge text-[10px]',
                                pod.status === 'Running' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                pod.status === 'Pending' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                                'bg-red-500/10 text-red-400 border-red-500/20'
                              )}>
                                {pod.status}
                              </span>
                              <span className="text-xs text-gray-600">
                                {pod.containers.length} container{pod.containers.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                          </div>
                          {/* Container details */}
                          {pod.containers.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-gray-700/30 space-y-1">
                              {pod.containers.map((c) => (
                                <div key={c.name} className="flex items-center justify-between text-xs">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <Circle
                                      size={6}
                                      className={clsx(
                                        'flex-shrink-0 fill-current',
                                        c.ready ? 'text-emerald-400' : 'text-gray-600'
                                      )}
                                    />
                                    <span className="text-gray-400 font-mono truncate">{c.name}</span>
                                  </div>
                                  <span className="text-gray-500 font-mono text-[10px] truncate max-w-[300px] text-right">{c.image}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Container Images */}
                {containerImages.size > 0 && (
                  <div className="card p-6">
                    <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2 mb-4">
                      <Image size={16} />
                      Container Images
                    </h3>
                    <div className="space-y-2">
                      {Array.from(containerImages.values()).map((img) => (
                        <div
                          key={img.image + ':' + img.tag}
                          className="flex items-center justify-between p-3 rounded-lg bg-gray-800/50 border border-gray-700/50"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-mono text-gray-200 truncate">{img.image}</p>
                            <p className="text-xs text-gray-500">Container: {img.name}</p>
                          </div>
                          <span className="badge text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/20 flex-shrink-0 ml-3">
                            {img.tag}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Pod Events */}
                <div className="card p-6">
                  <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2 mb-4">
                    <AlertTriangle size={16} />
                    Events
                  </h3>
                  {k8sEvents === undefined && (
                    <p className="text-sm text-gray-500">Loading events...</p>
                  )}
                  {k8sEvents && deploymentEvents.length === 0 && (
                    <p className="text-sm text-gray-500">No recent events for this deployment</p>
                  )}
                  {deploymentEvents.length > 0 && (
                    <div className="space-y-1.5">
                      {deploymentEvents.slice(0, 25).map((event, i) => (
                        <div
                          key={`${event.involvedObject.name}-${event.reason}-${i}`}
                          className={clsx(
                            'flex items-start gap-3 p-2.5 rounded-lg text-xs',
                            event.type === 'Warning'
                              ? 'bg-amber-500/5 border border-amber-500/10'
                              : 'bg-gray-800/30 border border-gray-700/30'
                          )}
                        >
                          <Circle
                            size={7}
                            className={clsx(
                              'flex-shrink-0 fill-current mt-0.5',
                              event.type === 'Warning' ? 'text-amber-400' : 'text-gray-500'
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className={clsx(
                                'font-medium',
                                event.type === 'Warning' ? 'text-amber-400' : 'text-gray-300'
                              )}>
                                {event.reason}
                              </span>
                              <span className="text-gray-600 font-mono">{event.involvedObject.name}</span>
                              {event.count > 1 && (
                                <span className="text-gray-600">x{event.count}</span>
                              )}
                            </div>
                            <p className="text-gray-500 break-words">{event.message}</p>
                            {(event.lastTimestamp || event.firstTimestamp) && (
                              <p className="text-gray-600 mt-0.5">
                                {formatRelativeTime(event.lastTimestamp || event.firstTimestamp)}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* All Deployments in Namespace */}
                {k8sDeployments && k8sDeployments.length > 1 && (
                  <div className="card p-6">
                    <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2 mb-4">
                      <Server size={16} />
                      All Deployments in {k8sNamespace}
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-gray-500 border-b border-gray-700/50">
                            <th className="text-left py-2 pr-4 font-medium">Name</th>
                            <th className="text-left py-2 pr-4 font-medium">Ready</th>
                            <th className="text-left py-2 pr-4 font-medium">Available</th>
                            <th className="text-left py-2 pr-4 font-medium">Created</th>
                          </tr>
                        </thead>
                        <tbody>
                          {k8sDeployments.map((dep) => (
                            <tr key={dep.name} className={clsx(
                              'border-b border-gray-800/50',
                              matchingDep && dep.name === matchingDep.name && 'bg-blue-500/5'
                            )}>
                              <td className="py-2 pr-4 font-mono text-gray-200">
                                {dep.name}
                                {matchingDep && dep.name === matchingDep.name && (
                                  <span className="ml-2 badge text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/20">current</span>
                                )}
                              </td>
                              <td className="py-2 pr-4">
                                <span className={clsx(
                                  dep.readyReplicas >= dep.replicas ? 'text-emerald-400' :
                                  dep.readyReplicas > 0 ? 'text-amber-400' : 'text-red-400'
                                )}>
                                  {dep.readyReplicas}/{dep.replicas}
                                </span>
                              </td>
                              <td className="py-2 pr-4 text-gray-400">{dep.availableReplicas}</td>
                              <td className="py-2 pr-4 text-gray-500">{formatRelativeTime(dep.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {!k8sIntegrationId && (
                  <div className="card p-6 text-center text-sm text-gray-500">
                    No Kubernetes integration configured. Add a Kubernetes integration in Settings to see live K8s data.
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {activeTab === 'vercel' && isVercel && (
        <div className="space-y-6">
          {vercelLoading && (
            <div className="card p-8 text-center text-sm text-gray-500">
              Loading Vercel project details...
            </div>
          )}

          {!vercelLoading && !vercelDetails && !vercelIntegrationId && (
            <div className="card p-6 text-center text-sm text-gray-500">
              No Vercel integration configured. Add a Vercel integration in Settings to see live Vercel data.
            </div>
          )}

          {!vercelLoading && !vercelDetails && vercelIntegrationId && (
            <div className="card p-6 text-center text-sm text-gray-500">
              Could not load project details. The project may not be linked via infrastructure bindings.
            </div>
          )}

          {vercelDetails && (
            <>
              {/* Project Info */}
              <div className="card p-6">
                <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2 mb-4">
                  <Triangle size={16} />
                  Project: {vercelDetails.name}
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Framework</p>
                    <p className="text-gray-200 font-medium">
                      {vercelDetails.framework || 'Not set'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Node Version</p>
                    <p className="text-gray-200 font-medium font-mono">
                      {vercelDetails.nodeVersion || 'Default'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Build Command</p>
                    <p className="text-gray-200 font-medium font-mono text-xs truncate" title={vercelDetails.buildCommand || 'Default'}>
                      {vercelDetails.buildCommand || 'Default'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Output Directory</p>
                    <p className="text-gray-200 font-medium font-mono text-xs">
                      {vercelDetails.outputDirectory || 'Default'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Domains & Environment */}
              <div className="card p-6">
                <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2 mb-4">
                  <Globe size={16} />
                  Domains & Environment
                </h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Production Domain</p>
                    {vercelDetails.productionDomain ? (
                      <a
                        href={vercelDetails.productionDomain}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1"
                      >
                        {vercelDetails.productionDomain}
                        <ExternalLink size={12} />
                      </a>
                    ) : (
                      <p className="text-gray-400">No custom domain</p>
                    )}
                  </div>
                  <div>
                    <p className="text-gray-500">All Domains</p>
                    <div className="space-y-0.5">
                      {vercelDetails.domains.length > 0 ? vercelDetails.domains.map((d) => (
                        <p key={d} className="text-gray-300 text-xs font-mono">{d}</p>
                      )) : (
                        <p className="text-gray-400">None</p>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-gray-500 flex items-center gap-1">
                      <Key size={12} />
                      Environment Variables
                    </p>
                    <p className="text-gray-200 font-medium">{vercelDetails.envVarsCount} variables</p>
                  </div>
                  <div>
                    <p className="text-gray-500 flex items-center gap-1">
                      <BarChart3 size={12} />
                      Analytics
                    </p>
                    <div className="flex items-center gap-3">
                      <span className={clsx(
                        'badge text-[10px]',
                        vercelDetails.analytics.webAnalytics
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : 'bg-gray-700/50 text-gray-500 border-gray-600/50'
                      )}>
                        Web Analytics {vercelDetails.analytics.webAnalytics ? 'ON' : 'OFF'}
                      </span>
                      <span className={clsx(
                        'badge text-[10px]',
                        vercelDetails.analytics.speedInsights
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : 'bg-gray-700/50 text-gray-500 border-gray-600/50'
                      )}>
                        Speed Insights {vercelDetails.analytics.speedInsights ? 'ON' : 'OFF'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Git Repo */}
                {vercelDetails.gitRepo && (
                  <div className="mt-4 pt-4 border-t border-gray-700/50">
                    <p className="text-gray-500 text-xs mb-1 flex items-center gap-1">
                      <GitBranch size={12} />
                      Connected Repository
                    </p>
                    <p className="text-gray-200 font-medium text-sm font-mono">
                      {vercelDetails.gitRepo.org}/{vercelDetails.gitRepo.repo}
                    </p>
                  </div>
                )}
              </div>

              {/* Recent Deployments */}
              <div className="card p-6">
                <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2 mb-4">
                  <Rocket size={16} />
                  Latest Deployments ({vercelDetails.latestDeployments.length})
                </h3>
                {vercelDetails.latestDeployments.length === 0 ? (
                  <p className="text-sm text-gray-500">No recent deployments</p>
                ) : (
                  <div className="space-y-2">
                    {vercelDetails.latestDeployments.map((dep) => (
                      <div
                        key={dep.uid}
                        className="flex items-center justify-between p-3 rounded-lg bg-gray-800/50 border border-gray-700/50"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Circle
                            size={8}
                            className={clsx(
                              'flex-shrink-0 fill-current',
                              dep.state === 'READY' ? 'text-emerald-400' :
                              dep.state === 'BUILDING' || dep.state === 'INITIALIZING' || dep.state === 'QUEUED' ? 'text-amber-400' :
                              dep.state === 'ERROR' || dep.state === 'CANCELED' ? 'text-red-400' :
                              'text-gray-400'
                            )}
                          />
                          <div className="min-w-0">
                            <p className="text-sm text-gray-200 truncate">
                              {dep.commitMessage || dep.uid.slice(0, 12)}
                            </p>
                            <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                              {dep.branch && (
                                <span className="flex items-center gap-1 font-mono">
                                  <GitBranch size={10} />
                                  {dep.branch}
                                </span>
                              )}
                              <span>{dep.creator}</span>
                              <span>{formatRelativeTime(new Date(dep.created).toISOString())}</span>
                              {dep.commitSha && (
                                <span className="font-mono">{dep.commitSha.slice(0, 7)}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          {dep.target && (
                            <span className={clsx(
                              'badge text-[10px]',
                              dep.target === 'production'
                                ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                                : 'bg-gray-700/50 text-gray-400 border-gray-600/50'
                            )}>
                              {dep.target}
                            </span>
                          )}
                          <span className={clsx(
                            'badge text-[10px]',
                            dep.state === 'READY' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                            dep.state === 'BUILDING' || dep.state === 'INITIALIZING' || dep.state === 'QUEUED' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                            dep.state === 'ERROR' || dep.state === 'CANCELED' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                            'bg-gray-700/50 text-gray-400 border-gray-600/50'
                          )}>
                            {dep.state}
                          </span>
                          {dep.url && (
                            <a
                              href={dep.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gray-500 hover:text-blue-400 transition-colors"
                            >
                              <ExternalLink size={12} />
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'diagnosis' && <DiagnosisPanel serviceId={service.id} />}

      {activeTab === 'logs' && (
        <div className="h-[calc(100vh-16rem)]">
          <LogViewer initialServiceId={service.id} />
        </div>
      )}

      {/* Terminal Pod Selection Modal */}
      {showTerminalModal && k8sNamespace && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowTerminalModal(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
              <Terminal size={18} />
              Open Terminal
            </h3>
            <p className="text-sm text-gray-400 mb-3">Select a pod to connect to:</p>
            {k8sPods && k8sPods.length > 0 ? (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {k8sPods
                  .filter((p) => p.name.includes(k8sDeploymentName || ''))
                  .map((pod) => (
                    <button
                      key={pod.name}
                      onClick={async () => {
                        setShowTerminalModal(false);
                        const cmd = `kubectl exec -it ${pod.name} -n ${k8sNamespace} -- /bin/sh`;
                        try {
                          // Try opening macOS Terminal via osascript
                          const { invoke } = await import('@tauri-apps/api/core');
                          await invoke('open_terminal', { command: cmd });
                        } catch {
                          // Fallback: copy command to clipboard
                          await navigator.clipboard.writeText(cmd);
                          alert('Befehl in die Zwischenablage kopiert. Öffne ein Terminal und füge ihn ein.');
                        }
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-200 hover:bg-gray-800 transition-colors flex items-center justify-between"
                    >
                      <span className="font-mono text-xs truncate">{pod.name}</span>
                      <span className={clsx(
                        'text-[10px] px-1.5 py-0.5 rounded',
                        pod.ready ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                      )}>
                        {pod.status}
                      </span>
                    </button>
                  ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No pods found for this deployment</p>
            )}
            <button
              onClick={() => setShowTerminalModal(false)}
              className="mt-4 w-full btn-secondary text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
