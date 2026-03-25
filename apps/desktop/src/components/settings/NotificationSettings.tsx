import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notifications as api } from '@/lib/api';
import type { NotificationRule, NotificationChannel, NotificationEventType, IncidentSeverity } from '@/types';
import { Bell, Plus, Trash2, TestTube, ToggleLeft, ToggleRight, Loader2, X, CheckCircle2 } from 'lucide-react';
import clsx from 'clsx';

const eventTypes: NotificationEventType[] = [
  'incident.opened',
  'incident.resolved',
  'deployment.failed',
  'health.down',
];

const channels: NotificationChannel[] = ['slack', 'email', 'webhook'];
const severities: IncidentSeverity[] = ['critical', 'warning', 'info'];

export default function NotificationSettings() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<NotificationRule | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    eventType: 'incident.opened' as NotificationEventType,
    channel: 'slack' as NotificationChannel,
    severity: '' as IncidentSeverity | '',
    cooldownMinutes: 15,
    enabled: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: rules, isLoading, error } = useQuery({
    queryKey: ['notifications', 'rules'],
    queryFn: api.listRules,
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<NotificationRule>) => api.createRule(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<NotificationRule> }) =>
      api.updateRule(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteRule(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => api.testRule(id),
  });

  function resetForm() {
    setShowForm(false);
    setEditingRule(null);
    setFormData({
      name: '',
      eventType: 'incident.opened',
      channel: 'slack',
      severity: '',
      cooldownMinutes: 15,
      enabled: true,
    });
    setErrors({});
  }

  function openEdit(rule: NotificationRule) {
    setEditingRule(rule);
    setFormData({
      name: rule.name,
      eventType: rule.eventType,
      channel: rule.channel,
      severity: rule.severity || '',
      cooldownMinutes: rule.cooldownMinutes ?? 15,
      enabled: rule.enabled,
    });
    setShowForm(true);
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!formData.name.trim()) errs.name = 'Name is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    const payload: Partial<NotificationRule> = {
      name: formData.name.trim(),
      eventType: formData.eventType,
      channel: formData.channel,
      severity: formData.severity || null,
      cooldownMinutes: formData.cooldownMinutes,
      enabled: formData.enabled,
    };
    if (editingRule) {
      updateMutation.mutate({ id: editingRule.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          <Bell size={16} />
          Notification Rules
        </h3>
        <button
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          className="btn-primary text-sm flex items-center gap-2"
        >
          <Plus size={14} />
          Add Rule
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="card p-4 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-gray-200">
              {editingRule ? 'Edit Rule' : 'New Rule'}
            </h4>
            <button type="button" onClick={resetForm} className="text-gray-500 hover:text-gray-300">
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="input"
                placeholder="Rule name"
              />
              {errors.name && <p className="text-xs text-red-400 mt-1">{errors.name}</p>}
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Event Type</label>
              <select
                value={formData.eventType}
                onChange={(e) =>
                  setFormData({ ...formData, eventType: e.target.value as NotificationEventType })
                }
                className="input"
              >
                {eventTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Channel</label>
              <select
                value={formData.channel}
                onChange={(e) =>
                  setFormData({ ...formData, channel: e.target.value as NotificationChannel })
                }
                className="input"
              >
                {channels.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Severity Filter</label>
              <select
                value={formData.severity}
                onChange={(e) =>
                  setFormData({ ...formData, severity: e.target.value as IncidentSeverity | '' })
                }
                className="input"
              >
                <option value="">All severities</option>
                {severities.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Cooldown (minutes)</label>
              <input
                type="number"
                value={formData.cooldownMinutes}
                onChange={(e) =>
                  setFormData({ ...formData, cooldownMinutes: parseInt(e.target.value, 10) || 15 })
                }
                className="input w-32"
                min={0}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
              className="btn-primary text-sm"
            >
              {createMutation.isPending || updateMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : editingRule ? (
                'Update Rule'
              ) : (
                'Create Rule'
              )}
            </button>
            <button type="button" onClick={resetForm} className="btn-secondary text-sm">
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Error */}
      {error && (
        <div className="card p-6 text-center text-red-400">Failed to load notification rules</div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton w-full h-16 rounded-lg" />
          ))}
        </div>
      )}

      {/* Empty */}
      {rules && rules.length === 0 && !isLoading && (
        <div className="card p-8 text-center">
          <Bell size={32} className="mx-auto text-gray-600 mb-3" />
          <p className="text-gray-400">No notification rules configured</p>
        </div>
      )}

      {/* List */}
      {rules && rules.length > 0 && (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className="card p-4">
              <div className="flex items-center justify-between">
                <div
                  className="flex-1 cursor-pointer"
                  onClick={() => openEdit(rule)}
                >
                  <div className="flex items-center gap-3">
                    <h4 className="text-sm font-medium text-gray-200">{rule.name}</h4>
                    <span className="badge bg-gray-700/50 text-gray-400 border-gray-600/50 text-[10px]">
                      {rule.eventType}
                    </span>
                    <span className="badge bg-gray-700/50 text-gray-400 border-gray-600/50 text-[10px]">
                      {rule.channel}
                    </span>
                    {rule.severity && (
                      <span className="badge bg-gray-700/50 text-gray-400 border-gray-600/50 text-[10px]">
                        {rule.severity}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => testMutation.mutate(rule.id)}
                    disabled={testMutation.isPending}
                    className="btn-ghost text-xs py-1 flex items-center gap-1"
                  >
                    {testMutation.isPending ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : testMutation.isSuccess ? (
                      <CheckCircle2 size={12} className="text-emerald-400" />
                    ) : (
                      <TestTube size={12} />
                    )}
                    Test
                  </button>
                  <button
                    onClick={() =>
                      updateMutation.mutate({
                        id: rule.id,
                        data: { enabled: !rule.enabled },
                      })
                    }
                    className="text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    {rule.enabled ? (
                      <ToggleRight size={22} className="text-emerald-400" />
                    ) : (
                      <ToggleLeft size={22} className="text-gray-600" />
                    )}
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(rule.id)}
                    className="text-gray-600 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
