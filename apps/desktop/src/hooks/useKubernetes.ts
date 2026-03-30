import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { kubernetes } from '@/lib/api';

export function useK8sNamespaces(integrationId: string | undefined, clusterName?: string) {
  return useQuery({
    queryKey: ['k8s', 'namespaces', integrationId, clusterName],
    queryFn: () => kubernetes.namespaces(integrationId!, clusterName),
    enabled: !!integrationId,
    refetchInterval: 30_000,
  });
}

export function useK8sCronJobs(integrationId: string | undefined, namespace?: string, clusterName?: string) {
  return useQuery({
    queryKey: ['k8s', 'cronjobs', integrationId, namespace, clusterName],
    queryFn: () => kubernetes.cronJobs(integrationId!, namespace, clusterName),
    enabled: !!integrationId,
    refetchInterval: 15_000,
  });
}

export function useK8sCluster(integrationId: string | undefined, clusterName?: string) {
  return useQuery({
    queryKey: ['k8s', 'cluster', integrationId, clusterName],
    queryFn: () => kubernetes.cluster(integrationId!, clusterName),
    enabled: !!integrationId,
    refetchInterval: 60_000,
  });
}

export function useK8sPods(integrationId: string | undefined, namespace?: string, clusterName?: string) {
  return useQuery({
    queryKey: ['k8s', 'pods', integrationId, namespace, clusterName],
    queryFn: () => kubernetes.pods(integrationId!, namespace, clusterName),
    enabled: !!integrationId,
    refetchInterval: 10_000,
  });
}

export function useK8sDeployments(integrationId: string | undefined, namespace?: string, clusterName?: string) {
  return useQuery({
    queryKey: ['k8s', 'deployments', integrationId, namespace, clusterName],
    queryFn: () => kubernetes.deployments(integrationId!, namespace, clusterName),
    enabled: !!integrationId,
    refetchInterval: 10_000,
  });
}

export function useK8sPodMetrics(integrationId: string | undefined, namespace?: string, clusterName?: string) {
  return useQuery({
    queryKey: ['k8s', 'metrics', integrationId, namespace, clusterName],
    queryFn: () => kubernetes.metrics(integrationId!, namespace, clusterName),
    enabled: !!integrationId,
    refetchInterval: 15_000,
  });
}

export function useK8sEvents(integrationId: string | undefined, namespace?: string, name?: string, clusterName?: string) {
  return useQuery({
    queryKey: ['k8s', 'events', integrationId, namespace, name, clusterName],
    queryFn: () => kubernetes.events(integrationId!, namespace, name, clusterName),
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
      clusterName,
    }: {
      integrationId: string;
      namespace: string;
      name: string;
      clusterName?: string;
    }) => kubernetes.restartDeployment(integrationId, namespace, name, clusterName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['k8s', 'deployments'] });
      qc.invalidateQueries({ queryKey: ['k8s', 'pods'] });
    },
  });
}
