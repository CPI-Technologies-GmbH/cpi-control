import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { services as api } from '@/lib/api';
import type { ServiceFilters, Service } from '@/types';

export function useServices(filters?: ServiceFilters) {
  return useQuery({
    queryKey: ['services', filters],
    queryFn: () => api.list(filters),
    refetchInterval: 10_000,
  });
}

export function useService(id: string | undefined) {
  return useQuery({
    queryKey: ['services', id],
    queryFn: () => api.get(id!),
    enabled: !!id,
  });
}

import type { HealthCheckResult } from '@/types';

const BASE_URL = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE_URL) || 'http://localhost:19876';

export function useServiceHealth(serviceId: string, params?: { since?: string; limit?: number; offset?: number }) {
  return useQuery({
    queryKey: ['services', serviceId, 'health', params],
    queryFn: async (): Promise<{ data: HealthCheckResult[]; total: number }> => {
      const sp = new URLSearchParams();
      if (params?.since) sp.set('since', params.since);
      if (params?.limit) sp.set('limit', String(params.limit));
      if (params?.offset) sp.set('offset', String(params.offset));
      const qs = sp.toString();
      const url = `${BASE_URL}/api/inventory/services/${serviceId}/health-checks${qs ? `?${qs}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch health checks');
      return res.json();
    },
    enabled: !!serviceId,
    refetchInterval: 30_000,
  });
}

export function useCreateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Service>) => api.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services'] });
    },
  });
}

export function useUpdateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Service> }) => api.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services'] });
    },
  });
}

export function useDeleteService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services'] });
    },
  });
}

export function useBatchUpdateServices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, updates }: { ids: string[]; updates: Partial<Service> }) =>
      api.batchUpdate(ids, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services'] });
    },
  });
}

export function useBatchDeleteServices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.batchDelete(ids),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services'] });
    },
  });
}
