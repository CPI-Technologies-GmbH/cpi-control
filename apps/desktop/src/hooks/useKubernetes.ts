import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { kubernetes } from '@/lib/api';

export function useK8sNamespaces(integrationId: string | undefined) {
  return useQuery({
    queryKey: ['k8s', 'namespaces', integrationId],
    queryFn: () => kubernetes.namespaces(integrationId!),
    enabled: !!integrationId,
    refetchInterval: 30_000,
  });
}

export function useK8sCronJobs(integrationId: string | undefined, namespace?: string) {
  return useQuery({
    queryKey: ['k8s', 'cronjobs', integrationId, namespace],
    queryFn: () => kubernetes.cronJobs(integrationId!, namespace),
    enabled: !!integrationId,
    refetchInterval: 15_000,
  });
}

export function useK8sCluster(integrationId: string | undefined) {
  return useQuery({
    queryKey: ['k8s', 'cluster', integrationId],
    queryFn: () => kubernetes.cluster(integrationId!),
    enabled: !!integrationId,
    refetchInterval: 60_000,
  });
}

export function useK8sPods(integrationId: string | undefined, namespace?: string) {
  return useQuery({
    queryKey: ['k8s', 'pods', integrationId, namespace],
    queryFn: () => kubernetes.pods(integrationId!, namespace),
    enabled: !!integrationId,
    refetchInterval: 10_000,
  });
}

export function useK8sDeployments(integrationId: string | undefined, namespace?: string) {
  return useQuery({
    queryKey: ['k8s', 'deployments', integrationId, namespace],
    queryFn: () => kubernetes.deployments(integrationId!, namespace),
    enabled: !!integrationId,
    refetchInterval: 10_000,
  });
}

export function useK8sPodMetrics(integrationId: string | undefined, namespace?: string) {
  return useQuery({
    queryKey: ['k8s', 'metrics', integrationId, namespace],
    queryFn: () => kubernetes.metrics(integrationId!, namespace),
    enabled: !!integrationId,
    refetchInterval: 15_000,
  });
}

export function useK8sEvents(integrationId: string | undefined, namespace?: string, name?: string) {
  return useQuery({
    queryKey: ['k8s', 'events', integrationId, namespace, name],
    queryFn: () => kubernetes.events(integrationId!, namespace, name),
    enabled: !!integrationId,
    refetchInterval: 15_000,
  });
}

export function useRestartDeployment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      integrationId,
      namespace,
      name,
    }: {
      integrationId: string;
      namespace: string;
      name: string;
    }) => kubernetes.restartDeployment(integrationId, namespace, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['k8s', 'deployments'] });
      qc.invalidateQueries({ queryKey: ['k8s', 'pods'] });
    },
  });
}
