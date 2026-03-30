import { useQuery } from '@tanstack/react-query';
import { projects } from '@/lib/api';

export function useProjectStats(projectId: string | undefined) {
  return useQuery({
    queryKey: ['projects', projectId, 'stats'],
    queryFn: () => projects.stats(projectId!),
    enabled: !!projectId,
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
}
