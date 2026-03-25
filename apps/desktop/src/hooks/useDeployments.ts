import { useQuery } from '@tanstack/react-query';
import { deployments as api } from '@/lib/api';
import type { DeploymentFilters } from '@/types';

export function useDeployments(filters?: DeploymentFilters) {
  return useQuery({
    queryKey: ['deployments', filters],
    queryFn: () => api.list(filters),
    refetchInterval: 15_000,
  });
}

export function useDeploymentsByService(serviceId: string | undefined) {
  return useQuery({
    queryKey: ['deployments', 'service', serviceId],
    queryFn: () => api.byService(serviceId!),
    enabled: !!serviceId,
    refetchInterval: 15_000,
  });
}

export function useDeployment(id: string | undefined) {
  return useQuery({
    queryKey: ['deployments', id],
    queryFn: () => api.get(id!),
    enabled: !!id,
  });
}
