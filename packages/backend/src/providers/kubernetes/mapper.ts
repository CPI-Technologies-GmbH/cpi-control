import type { K8sPod, K8sDeployment, K8sEvent, K8sService, K8sIngress, K8sCronJob, K8sNamespace } from './types.js';

export function mapPod(apiPod: any): K8sPod {
  const containerStatuses = apiPod.status?.containerStatuses || [];
  return {
    name: apiPod.metadata?.name || '',
    namespace: apiPod.metadata?.namespace || 'default',
    status: apiPod.status?.phase || 'Unknown',
    phase: apiPod.status?.phase || 'Unknown',
    ready: containerStatuses.every((c: any) => c.ready),
    restartCount: containerStatuses.reduce(
      (sum: number, c: any) => sum + (c.restartCount || 0),
      0
    ),
    createdAt: apiPod.metadata?.creationTimestamp || '',
    nodeName: apiPod.spec?.nodeName || '',
    containers: containerStatuses.map((c: any) => ({
      name: c.name,
      image: c.image,
      ready: c.ready,
      restartCount: c.restartCount || 0,
      state: Object.keys(c.state || {})[0] || 'unknown',
    })),
  };
}

export function mapDeployment(apiDeployment: any): K8sDeployment {
  return {
    name: apiDeployment.metadata?.name || '',
    namespace: apiDeployment.metadata?.namespace || 'default',
    replicas: apiDeployment.spec?.replicas || 0,
    readyReplicas: apiDeployment.status?.readyReplicas || 0,
    availableReplicas: apiDeployment.status?.availableReplicas || 0,
    updatedReplicas: apiDeployment.status?.updatedReplicas || 0,
    conditions: (apiDeployment.status?.conditions || []).map((c: any) => ({
      type: c.type,
      status: c.status,
      reason: c.reason || '',
      message: c.message || '',
      lastTransitionTime: c.lastTransitionTime || '',
    })),
    createdAt: apiDeployment.metadata?.creationTimestamp || '',
  };
}

export function mapEvent(apiEvent: any): K8sEvent {
  return {
    type: apiEvent.type || 'Normal',
    reason: apiEvent.reason || '',
    message: apiEvent.message || '',
    involvedObject: {
      kind: apiEvent.involvedObject?.kind || '',
      name: apiEvent.involvedObject?.name || '',
      namespace: apiEvent.involvedObject?.namespace || 'default',
    },
    firstTimestamp: apiEvent.firstTimestamp || '',
    lastTimestamp: apiEvent.lastTimestamp || '',
    count: apiEvent.count || 1,
  };
}

export function mapService(apiService: any): K8sService {
  const ports = (apiService.spec?.ports || []).map((p: any) => ({
    port: p.port,
    targetPort: p.targetPort ?? p.port,
    protocol: p.protocol || 'TCP',
    name: p.name || undefined,
  }));

  return {
    name: apiService.metadata?.name || '',
    namespace: apiService.metadata?.namespace || 'default',
    type: apiService.spec?.type || 'ClusterIP',
    clusterIP: apiService.spec?.clusterIP || '',
    ports,
    selector: apiService.spec?.selector || {},
    createdAt: apiService.metadata?.creationTimestamp || '',
  };
}

export function mapIngress(apiIngress: any): K8sIngress {
  const hosts: string[] = [];
  const paths: K8sIngress['paths'] = [];

  const rules = apiIngress.spec?.rules || [];
  for (const rule of rules) {
    const host = rule.host || '';
    if (host && !hosts.includes(host)) {
      hosts.push(host);
    }
    const httpPaths = rule.http?.paths || [];
    for (const p of httpPaths) {
      paths.push({
        host,
        path: p.path || '/',
        serviceName: p.backend?.service?.name || p.backend?.serviceName || '',
        servicePort:
          p.backend?.service?.port?.number ??
          p.backend?.service?.port?.name ??
          p.backend?.servicePort ??
          80,
      });
    }
  }

  const tlsHosts: string[] = [];
  const tlsEntries = apiIngress.spec?.tls || [];
  for (const tls of tlsEntries) {
    for (const h of tls.hosts || []) {
      if (!tlsHosts.includes(h)) {
        tlsHosts.push(h);
      }
    }
  }

  return {
    name: apiIngress.metadata?.name || '',
    namespace: apiIngress.metadata?.namespace || 'default',
    hosts,
    paths,
    tlsHosts,
    createdAt: apiIngress.metadata?.creationTimestamp || '',
  };
}

export function mapCronJob(apiCronJob: any): K8sCronJob {
  const containers = apiCronJob.spec?.jobTemplate?.spec?.template?.spec?.containers || [];
  return {
    name: apiCronJob.metadata?.name || '',
    namespace: apiCronJob.metadata?.namespace || 'default',
    schedule: apiCronJob.spec?.schedule || '',
    suspended: apiCronJob.spec?.suspend || false,
    lastScheduleTime: apiCronJob.status?.lastScheduleTime || null,
    activeJobs: (apiCronJob.status?.active || []).length,
    createdAt: apiCronJob.metadata?.creationTimestamp || '',
    concurrencyPolicy: apiCronJob.spec?.concurrencyPolicy || 'Allow',
    image: containers.length > 0 ? (containers[0].image || '') : '',
  };
}

export function mapNamespace(apiNamespace: any): K8sNamespace {
  return {
    name: apiNamespace.metadata?.name || '',
    status: apiNamespace.status?.phase || 'Unknown',
    labels: apiNamespace.metadata?.labels || {},
    createdAt: apiNamespace.metadata?.creationTimestamp || '',
  };
}

export function podStatusToHealthStatus(phase: string): string {
  switch (phase) {
    case 'Running':
      return 'healthy';
    case 'Pending':
      return 'degraded';
    case 'Failed':
    case 'Unknown':
      return 'down';
    case 'Succeeded':
      return 'healthy';
    default:
      return 'unknown';
  }
}
