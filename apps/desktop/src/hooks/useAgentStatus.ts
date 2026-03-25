import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { agent as api } from '@/lib/api';
import type { AgentInstallRequest } from '@/types';

export function useAgentList() {
  return useQuery({
    queryKey: ['agent', 'list'],
    queryFn: () => api.list(),
    refetchInterval: 30_000,
  });
}

export function useAgentStatus(id: string | undefined) {
  return useQuery({
    queryKey: ['agent', id, 'status'],
    queryFn: () => api.status(id!),
    enabled: !!id,
    refetchInterval: 30_000,
  });
}

export function useAgentSettings(id: string | undefined) {
  return useQuery({
    queryKey: ['agent', id, 'settings'],
    queryFn: () => api.settings.get(id!),
    enabled: !!id,
  });
}

export function useAgentConfigPreview(id: string | undefined) {
  return useQuery({
    queryKey: ['agent', id, 'config-preview'],
    queryFn: () => api.configPreview(id!),
    enabled: !!id,
  });
}

export function useInstallAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: AgentInstallRequest) => api.install(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent'] });
    },
  });
}

export function useSyncAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.sync(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent'] });
    },
  });
}

export function useRestartAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.restart(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent'] });
    },
  });
}

export function useUninstallAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.uninstall(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent'] });
    },
  });
}

export function useUpdateAgentSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<import('@/types').AgentSettings> }) =>
      api.settings.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent', 'settings'] });
    },
  });
}
