import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { incidents as api } from '@/lib/api';
import type { IncidentFilters } from '@/types';

export function useIncidents(filters?: IncidentFilters) {
  return useQuery({
    queryKey: ['incidents', filters],
    queryFn: () => api.list(filters),
    refetchInterval: 10_000,
  });
}

export function useIncident(id: string | undefined) {
  return useQuery({
    queryKey: ['incidents', id],
    queryFn: () => api.get(id!),
    enabled: !!id,
  });
}

export function useIncidentEvents(id: string | undefined) {
  return useQuery({
    queryKey: ['incidents', id, 'events'],
    queryFn: () => api.events(id!),
    enabled: !!id,
  });
}

export function useAcknowledgeIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, by }: { id: string; by?: string }) => api.acknowledge(id, by),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['incidents'] });
      qc.invalidateQueries({ queryKey: ['incidents', variables.id] });
    },
  });
}

export function useResolveIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      resolvedBy,
      rootCause,
    }: {
      id: string;
      resolvedBy?: string;
      rootCause?: string;
    }) => api.resolve(id, { resolvedBy, rootCause }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['incidents'] });
      qc.invalidateQueries({ queryKey: ['incidents', variables.id] });
    },
  });
}
