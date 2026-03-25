import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  useIncident,
  useIncidentEvents,
  useAcknowledgeIncident,
  useResolveIncident,
} from '@/hooks/useIncidents';
import DiagnosisPanel from '@/components/diagnosis/DiagnosisPanel';
import {
  severityColor,
  statusBgColor,
  formatDate,
  formatRelativeTime,
} from '@/lib/formatters';
import {
  ArrowLeft,
  AlertTriangle,
  AlertCircle,
  Info,
  Clock,
  CheckCircle2,
  Eye,
  Shield,
  MessageSquare,
  Cpu,
  Stethoscope,
  Loader2,
} from 'lucide-react';
import clsx from 'clsx';
import type { IncidentEvent, IncidentSeverity, IncidentEventType } from '@/types';

function SeverityIcon({ severity, size = 20 }: { severity: IncidentSeverity; size?: number }) {
  switch (severity) {
    case 'critical':
      return <AlertCircle size={size} className="text-red-400" />;
    case 'warning':
      return <AlertTriangle size={size} className="text-amber-400" />;
    case 'info':
      return <Info size={size} className="text-blue-400" />;
  }
}

function EventIcon({ type }: { type: IncidentEventType }) {
  switch (type) {
    case 'detected':
      return <AlertCircle size={14} className="text-red-400" />;
    case 'acknowledged':
      return <Eye size={14} className="text-blue-400" />;
    case 'escalated':
      return <AlertTriangle size={14} className="text-amber-400" />;
    case 'resolved':
      return <CheckCircle2 size={14} className="text-emerald-400" />;
    case 'comment':
      return <MessageSquare size={14} className="text-gray-400" />;
    case 'diagnostic':
      return <Cpu size={14} className="text-purple-400" />;
  }
}

function EventTimeline({ events }: { events: IncidentEvent[] }) {
  if (!events || events.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-gray-500">
        No events recorded yet
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="absolute left-[17px] top-3 bottom-3 w-px bg-gray-800" />
      <div className="space-y-0">
        {events.map((event) => (
          <div
            key={event.id}
            className="flex items-start gap-4 p-3 hover:bg-gray-800/20 rounded-lg transition-colors relative"
          >
            <div className="w-3.5 h-3.5 rounded-full bg-gray-900 border-2 border-gray-700 flex items-center justify-center flex-shrink-0 mt-1 z-10">
              <EventIcon type={event.type} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-medium text-gray-300 uppercase">
                  {event.type}
                </span>
                {event.source && (
                  <span className="badge text-[10px] bg-gray-700/50 text-gray-400 border-gray-600/50">
                    {event.source}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-300">{event.message}</p>
              <p className="text-xs text-gray-600 mt-1">{formatDate(event.createdAt)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function IncidentDetail() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<'timeline' | 'diagnosis'>('timeline');
  const [resolveRootCause, setResolveRootCause] = useState('');
  const [showResolveForm, setShowResolveForm] = useState(false);

  const { data: incident, isLoading, error } = useIncident(id);
  const { data: events, isLoading: eventsLoading } = useIncidentEvents(id);
  const ackMutation = useAcknowledgeIncident();
  const resolveMutation = useResolveIncident();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="skeleton w-48 h-8 rounded" />
        <div className="skeleton w-full h-40 rounded-lg" />
        <div className="skeleton w-full h-64 rounded-lg" />
      </div>
    );
  }

  if (error || !incident) {
    return (
      <div className="card p-8 text-center">
        <p className="text-red-400 mb-4">
          {error ? 'Failed to load incident' : 'Incident not found'}
        </p>
        <Link to="/incidents" className="btn-secondary text-sm">
          Back to Incidents
        </Link>
      </div>
    );
  }

  const tabs: { key: 'timeline' | 'diagnosis'; label: string; icon: React.ReactNode }[] = [
    { key: 'timeline', label: 'Timeline', icon: <Clock size={14} /> },
    { key: 'diagnosis', label: 'Diagnosis', icon: <Stethoscope size={14} /> },
  ];

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        to="/incidents"
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors"
      >
        <ArrowLeft size={16} />
        Back to Incidents
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <SeverityIcon severity={incident.severity} />
          <div>
            <h1 className="text-xl font-bold text-gray-100 mb-1">{incident.title}</h1>
            <div className="flex items-center gap-3 text-sm text-gray-400">
              <Link
                to={`/services/${incident.serviceId}`}
                className="hover:text-blue-400 transition-colors"
              >
                {incident.serviceName || 'Unknown'}
              </Link>
              <span className="text-gray-700">|</span>
              <span>{incident.projectName || ''}</span>
              <span className="text-gray-700">|</span>
              <span className="flex items-center gap-1">
                <Clock size={12} />
                Detected {formatRelativeTime(incident.detectedAt)}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={clsx('badge', severityColor(incident.severity))}>
            {incident.severity}
          </span>
          <span className={clsx('badge', statusBgColor(incident.status))}>
            {incident.status}
          </span>
        </div>
      </div>

      {/* Action buttons */}
      {incident.status !== 'resolved' && (
        <div className="flex items-center gap-3">
          {incident.status === 'open' && (
            <button
              onClick={() => ackMutation.mutate({ id: incident.id, by: 'user' })}
              disabled={ackMutation.isPending}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              {ackMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Eye size={14} />
              )}
              Acknowledge
            </button>
          )}
          {!showResolveForm ? (
            <button
              onClick={() => setShowResolveForm(true)}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              <Shield size={14} />
              Resolve
            </button>
          ) : (
            <div className="flex items-center gap-3 flex-1">
              <input
                type="text"
                value={resolveRootCause}
                onChange={(e) => setResolveRootCause(e.target.value)}
                className="input text-sm flex-1 max-w-md"
                placeholder="Root cause (optional)"
              />
              <button
                onClick={() => {
                  resolveMutation.mutate({
                    id: incident.id,
                    resolvedBy: 'user',
                    rootCause: resolveRootCause || undefined,
                  });
                  setShowResolveForm(false);
                }}
                disabled={resolveMutation.isPending}
                className="btn-primary text-sm"
              >
                {resolveMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  'Confirm Resolve'
                )}
              </button>
              <button
                onClick={() => setShowResolveForm(false)}
                className="btn-ghost text-sm"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* Info cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <p className="text-xs text-gray-500 mb-1">Detected At</p>
          <p className="text-sm text-gray-200">{formatDate(incident.detectedAt)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 mb-1">Acknowledged At</p>
          <p className="text-sm text-gray-200">
            {incident.acknowledgedAt ? formatDate(incident.acknowledgedAt) : '—'}
          </p>
          {incident.acknowledgedBy && (
            <p className="text-xs text-gray-500">by {incident.acknowledgedBy}</p>
          )}
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 mb-1">Resolved At</p>
          <p className="text-sm text-gray-200">
            {incident.resolvedAt ? formatDate(incident.resolvedAt) : '—'}
          </p>
          {incident.resolvedBy && (
            <p className="text-xs text-gray-500">by {incident.resolvedBy}</p>
          )}
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 mb-1">Root Cause</p>
          <p className="text-sm text-gray-200">{incident.rootCause || '—'}</p>
        </div>
      </div>

      {/* Summary */}
      {incident.summary && (
        <div className="card p-4">
          <p className="text-xs text-gray-500 mb-1">Summary</p>
          <p className="text-sm text-gray-300 whitespace-pre-wrap">{incident.summary}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-6 border-b border-gray-800 pb-0">
        {tabs.map((tab) => (
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
      {activeTab === 'timeline' && (
        <div className="card">
          <div className="p-4 border-b border-gray-700/50">
            <h3 className="text-sm font-semibold text-gray-200">Event Timeline</h3>
          </div>
          {eventsLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="skeleton w-4 h-4 rounded-full" />
                  <div className="skeleton w-48 h-4 rounded" />
                </div>
              ))}
            </div>
          ) : (
            <EventTimeline events={events ?? []} />
          )}
        </div>
      )}

      {activeTab === 'diagnosis' && (
        <DiagnosisPanel serviceId={incident.serviceId} incidentId={incident.id} />
      )}
    </div>
  );
}
