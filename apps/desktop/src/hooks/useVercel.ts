import { useQuery } from '@tanstack/react-query';
import { vercel } from '@/lib/api';

export function useVercelProjects(integrationId: string | undefined) {
  return useQuery({
    queryKey: ['vercel', 'projects', integrationId],
    queryFn: () => vercel.projects(integrationId!),
    enabled: !!integrationId,
    refetchInterval: 60_000,
  });
}

export function useVercelProjectDetails(integrationId: string | undefined, projectId: string | undefined) {
  return useQuery({
    queryKey: ['vercel', 'project-details', integrationId, projectId],
    queryFn: () => vercel.projectDetails(integrationId!, projectId!),
    enabled: !!integrationId && !!projectId,
    refetchInterval: 30_000,
  });
}

export function useVercelDeployments(integrationId: string | undefined, projectId?: string, limit?: number) {
  return useQuery({
    queryKey: ['vercel', 'deployments', integrationId, projectId, limit],
    queryFn: () => vercel.deployments(integrationId!, projectId, limit),
    enabled: !!integrationId,
    refetchInterval: 15_000,
  });
}
