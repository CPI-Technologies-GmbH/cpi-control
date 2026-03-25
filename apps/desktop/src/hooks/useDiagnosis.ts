import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { diagnostics as api } from '@/lib/api';

export function useDiagnosticRuns(serviceId?: string) {
  return useQuery({
    queryKey: ['diagnostics', 'runs', serviceId],
    queryFn: () => api.listRuns(serviceId),
    refetchInterval: 10_000,
  });
}

export function useDiagnosticRun(id: string | undefined) {
  return useQuery({
    queryKey: ['diagnostics', 'runs', id],
    queryFn: () => api.getRun(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && data.status === 'running') return 3_000;
      return false;
    },
  });
}

export function useTriggerDiagnosis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ serviceId, incidentId }: { serviceId: string; incidentId?: string }) =>
      api.trigger(serviceId, incidentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['diagnostics'] });
    },
  });
}
