import type { DODroplet } from './types.js';

export function mapDroplet(apiDroplet: any): DODroplet {
  return {
    id: apiDroplet.id,
    name: apiDroplet.name,
    status: apiDroplet.status,
    memory: apiDroplet.memory,
    vcpus: apiDroplet.vcpus,
    disk: apiDroplet.disk,
    region: {
      slug: apiDroplet.region?.slug || '',
      name: apiDroplet.region?.name || '',
    },
    image: {
      id: apiDroplet.image?.id || 0,
      name: apiDroplet.image?.name || '',
      distribution: apiDroplet.image?.distribution || '',
    },
    networks: {
      v4: (apiDroplet.networks?.v4 || []).map((n: any) => ({
        ip_address: n.ip_address,
        netmask: n.netmask,
        gateway: n.gateway,
        type: n.type,
      })),
    },
    tags: apiDroplet.tags || [],
    created_at: apiDroplet.created_at,
  };
}

export function dropletStatusToHealthStatus(status: string): string {
  switch (status) {
    case 'active':
      return 'healthy';
    case 'new':
      return 'degraded';
    case 'off':
    case 'archive':
      return 'down';
    default:
      return 'unknown';
  }
}
