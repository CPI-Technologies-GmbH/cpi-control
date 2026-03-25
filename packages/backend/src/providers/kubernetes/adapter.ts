import https from 'node:https';
import type {
  ProviderAdapter,
  ConnectionTestResult,
  SyncOptions,
  SyncResult,
  SyncedDeployment,
} from '../../shared/provider-interface.js';
import { rateLimiter } from '../../shared/rate-limiter.js';
import { withRetry } from '../../shared/retry.js';
import { createChildLogger } from '../../shared/logger.js';
import { mapPod, mapDeployment, mapEvent, mapService, mapIngress, mapCronJob, mapNamespace } from './mapper.js';
import type { K8sConfig, K8sService, K8sIngress, K8sCronJob, K8sClusterInfo, K8sPodMetrics } from './types.js';

const log = createChildLogger('kubernetes-adapter');

/** Build an https.Agent for TLS client certificate auth and/or custom CA */
function buildTlsAgent(config: K8sConfig): https.Agent | undefined {
  const agentOptions: https.AgentOptions = {};
  let needsAgent = false;

  if (config.caCert) {
    agentOptions.ca = Buffer.from(config.caCert, 'base64').toString('utf-8');
    needsAgent = true;
  }
  if (config.clientCert) {
    agentOptions.cert = Buffer.from(config.clientCert, 'base64').toString('utf-8');
    needsAgent = true;
  }
  if (config.clientKey) {
    agentOptions.key = Buffer.from(config.clientKey, 'base64').toString('utf-8');
    needsAgent = true;
  }

  return needsAgent ? new https.Agent(agentOptions) : undefined;
}

export class KubernetesAdapter implements ProviderAdapter {
  readonly name = 'kubernetes';
  readonly version = '1.0.0';

  private async request(
    config: K8sConfig,
    path: string
  ): Promise<any> {
    await rateLimiter.acquireOrWait('kubernetes');

    if (!config.apiServer) {
      throw new Error('apiServer is required for Kubernetes API access');
    }

    const url = `${config.apiServer}${path}`;
    const tlsAgent = buildTlsAgent(config);

    return withRetry(
      async () => {
        const headers: Record<string, string> = {
          Accept: 'application/json',
        };

        if (config.token) {
          headers.Authorization = `Bearer ${config.token}`;
        }

        const fetchOptions: any = { headers };

        // Use custom TLS agent for client cert auth or custom CA
        if (tlsAgent) {
          fetchOptions.dispatcher = undefined; // Not needed with agent
          // Node.js native fetch supports the `agent` option through undici,
          // but the standard approach is to use node:https Agent.
          // We use the { agent } pattern supported by Node >= 18 via the
          // global fetch's underlying undici dispatcher.
          // For maximum compatibility, we make the request via https.request
          // when TLS client certs are needed.
          return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const reqOptions: https.RequestOptions = {
              hostname: parsedUrl.hostname,
              port: parsedUrl.port || 443,
              path: parsedUrl.pathname + parsedUrl.search,
              method: 'GET',
              headers,
              agent: tlsAgent,
            };

            const req = https.request(reqOptions, (res) => {
              let body = '';
              res.on('data', (chunk) => (body += chunk));
              res.on('end', () => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                  try {
                    resolve(JSON.parse(body));
                  } catch {
                    reject(new Error(`Invalid JSON from Kubernetes API: ${body.slice(0, 200)}`));
                  }
                } else {
                  reject(new Error(`Kubernetes API error ${res.statusCode}: ${body.slice(0, 500)}`));
                }
              });
            });

            req.on('error', (err) => reject(new Error(`Kubernetes API request failed: ${err.message}`)));
            req.end();
          });
        }

        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Kubernetes API error ${response.status}: ${body}`);
        }

        return response.json();
      },
      {
        maxAttempts: 3,
        retryOn: (err: unknown) => {
          const msg = String(err);
          return msg.includes('502') || msg.includes('503') || msg.includes('ECONNREFUSED');
        },
      }
    );
  }

  async requestWithBody(
    config: K8sConfig,
    path: string,
    method: string,
    body: unknown,
    contentType = 'application/json'
  ): Promise<any> {
    await rateLimiter.acquireOrWait('kubernetes');

    if (!config.apiServer) {
      throw new Error('apiServer is required for Kubernetes API access');
    }

    const url = `${config.apiServer}${path}`;
    const tlsAgent = buildTlsAgent(config);
    const bodyStr = JSON.stringify(body);

    return withRetry(
      async () => {
        const headers: Record<string, string> = {
          Accept: 'application/json',
          'Content-Type': contentType,
        };

        if (config.token) {
          headers.Authorization = `Bearer ${config.token}`;
        }

        if (tlsAgent) {
          return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const reqOptions: https.RequestOptions = {
              hostname: parsedUrl.hostname,
              port: parsedUrl.port || 443,
              path: parsedUrl.pathname + parsedUrl.search,
              method,
              headers,
              agent: tlsAgent,
            };

            const req = https.request(reqOptions, (res) => {
              let responseBody = '';
              res.on('data', (chunk) => (responseBody += chunk));
              res.on('end', () => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                  try {
                    resolve(JSON.parse(responseBody));
                  } catch {
                    reject(new Error(`Invalid JSON from Kubernetes API: ${responseBody.slice(0, 200)}`));
                  }
                } else {
                  reject(new Error(`Kubernetes API error ${res.statusCode}: ${responseBody.slice(0, 500)}`));
                }
              });
            });

            req.on('error', (err) => reject(new Error(`Kubernetes API request failed: ${err.message}`)));
            req.write(bodyStr);
            req.end();
          });
        }

        const response = await fetch(url, {
          method,
          headers,
          body: bodyStr,
        });

        if (!response.ok) {
          const respBody = await response.text();
          throw new Error(`Kubernetes API error ${response.status}: ${respBody}`);
        }

        return response.json();
      },
      {
        maxAttempts: 3,
        retryOn: (err: unknown) => {
          const msg = String(err);
          return msg.includes('502') || msg.includes('503') || msg.includes('ECONNREFUSED');
        },
      }
    );
  }

  async testConnection(config: Record<string, unknown>): Promise<ConnectionTestResult> {
    const k8sConfig = config as unknown as K8sConfig;
    if (!k8sConfig.apiServer) {
      return { success: false, message: 'Missing required config: apiServer' };
    }

    const start = Date.now();
    try {
      const version = await this.request(k8sConfig, '/version');
      return {
        success: true,
        message: `Connected to Kubernetes ${version.gitVersion}`,
        latencyMs: Date.now() - start,
        metadata: {
          gitVersion: version.gitVersion,
          platform: version.platform,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message,
        latencyMs: Date.now() - start,
      };
    }
  }

  async sync(config: Record<string, unknown>, options: SyncOptions): Promise<SyncResult> {
    const k8sConfig = config as unknown as K8sConfig;
    const start = Date.now();
    const errors: SyncResult['errors'] = [];
    const syncedDeployments: SyncedDeployment[] = [];
    let mappedServices: K8sService[] = [];
    let mappedIngresses: K8sIngress[] = [];
    let mappedCronJobs: K8sCronJob[] = [];
    let itemsSynced = 0;

    // Skip system namespaces when syncing cluster-wide
    const systemNamespaces = new Set([
      'kube-system', 'kube-public', 'kube-node-lease',
      'ingress-nginx', 'cert-manager', 'opentelemetry-operator-system',
    ]);

    try {
      // Fetch ALL namespaces to discover application workloads
      const namespacesResponse = await this.request(k8sConfig, '/api/v1/namespaces');
      const allNamespaces: string[] = (namespacesResponse.items || [])
        .map((ns: any) => ns.metadata?.name as string)
        .filter((ns: string) => ns && !systemNamespaces.has(ns));

      // If a specific namespace is configured, only sync that one
      const namespacesToSync = k8sConfig.namespace
        ? [k8sConfig.namespace]
        : allNamespaces;

      let allPods: any[] = [];
      let allDeployments: any[] = [];

      for (const ns of namespacesToSync) {
        try {
          // Fetch pods
          const podsResponse = await this.request(k8sConfig, `/api/v1/namespaces/${ns}/pods`);
          const pods = (podsResponse.items || []).map(mapPod);
          allPods.push(...pods);
          itemsSynced += pods.length;

          // Fetch deployments
          const deploymentsResponse = await this.request(k8sConfig, `/apis/apps/v1/namespaces/${ns}/deployments`);
          const deployments = (deploymentsResponse.items || []).map(mapDeployment);
          allDeployments.push(...deployments);
          itemsSynced += deployments.length;

          // Fetch services
          const servicesResponse = await this.request(k8sConfig, `/api/v1/namespaces/${ns}/services`);
          const services = (servicesResponse.items || []).map(mapService);
          mappedServices.push(...services);
          itemsSynced += services.length;

          // Fetch ingresses
          try {
            const ingressesResponse = await this.request(k8sConfig, `/apis/networking.k8s.io/v1/namespaces/${ns}/ingresses`);
            const ingresses = (ingressesResponse.items || []).map(mapIngress);
            mappedIngresses.push(...ingresses);
            itemsSynced += ingresses.length;
          } catch {
            // Ingress API may not be available
          }

          // Fetch CronJobs
          try {
            const cronJobsResponse = await this.request(k8sConfig, `/apis/batch/v1/namespaces/${ns}/cronjobs`);
            const cronJobs = (cronJobsResponse.items || []).map(mapCronJob);
            mappedCronJobs.push(...cronJobs);
            itemsSynced += cronJobs.length;
          } catch {
            // CronJob API may not be available
          }
        } catch (nsErr: any) {
          log.warn({ namespace: ns, error: nsErr.message }, 'Failed to sync namespace, continuing');
        }
      }

      const pods = allPods;
      const deployments = allDeployments;

      // Build ingress lookup: serviceName -> { hosts, hasIngress }
      const ingressByService = new Map<string, { hosts: string[]; tlsHosts: string[] }>();
      for (const ing of mappedIngresses) {
        for (const path of ing.paths) {
          if (!path.serviceName) continue;
          const existing = ingressByService.get(path.serviceName);
          if (existing) {
            if (path.host && !existing.hosts.includes(path.host)) {
              existing.hosts.push(path.host);
            }
          } else {
            ingressByService.set(path.serviceName, {
              hosts: path.host ? [path.host] : [],
              tlsHosts: ing.tlsHosts,
            });
          }
        }
      }

      // Map K8s deployments to SyncedDeployment records
      for (const dep of deployments) {
        const depNamespace = dep.namespace || 'default';

        // Determine status from replicas
        let status = 'unknown';
        if (dep.readyReplicas > 0 && dep.readyReplicas >= dep.replicas) {
          status = 'success';
        } else if (dep.readyReplicas > 0) {
          status = 'deploying';
        } else if (dep.replicas > 0) {
          status = 'failed';
        }

        // Find matching pods for this deployment (same namespace)
        const depPods = pods.filter((p: any) =>
          p.name.startsWith(dep.name) && (p.namespace || 'default') === depNamespace
        );
        const podStatus = depPods.length > 0 ? depPods[0].status : undefined;

        // Find matching K8s Service for this deployment (same namespace)
        const matchingK8sService = mappedServices.find((svc) => {
          if (svc.namespace !== depNamespace) return false;
          if (!svc.selector || Object.keys(svc.selector).length === 0) return false;
          return svc.selector['app'] === dep.name
            || svc.selector['app.kubernetes.io/name'] === dep.name
            || svc.name === dep.name;
        });

        // Check if this service has an ingress
        const ingress = ingressByService.get(matchingK8sService?.name || dep.name);
        const hasIngress = !!ingress;
        const ingressHosts = ingress?.hosts || [];
        const isPublic = hasIngress;

        syncedDeployments.push({
          externalId: `${depNamespace}/${dep.name}`,
          provider: 'kubernetes',
          status,
          environment: depNamespace === 'production' ? 'production' : depNamespace,
          startedAt: dep.createdAt || undefined,
          metadata: {
            namespace: depNamespace,
            deploymentName: dep.name,
            replicas: dep.replicas,
            readyReplicas: dep.readyReplicas,
            availableReplicas: dep.availableReplicas,
            podStatus,
            podCount: depPods.length,
            k8sServiceType: matchingK8sService?.type || null,
            hasIngress,
            ingressHosts,
            isPublic,
          },
        });
      }

      log.info(
        {
          namespaces: namespacesToSync.length,
          pods: pods.length,
          deployments: deployments.length,
          services: mappedServices.length,
          ingresses: mappedIngresses.length,
          cronJobs: mappedCronJobs.length,
        },
        'Kubernetes sync completed'
      );
    } catch (err: any) {
      errors.push({
        item: `kubernetes-sync`,
        error: err.message,
        retryable: true,
      });
    }

    return {
      success: errors.length === 0,
      itemsSynced,
      errors,
      durationMs: Date.now() - start,
      data: {
        deployments: syncedDeployments,
        k8sServices: mappedServices,
        k8sIngresses: mappedIngresses,
        k8sCronJobs: mappedCronJobs,
      },
    };
  }

  async getServices(config: K8sConfig, namespace?: string) {
    const ns = namespace || config.namespace || 'default';
    const response = await this.request(config, `/api/v1/namespaces/${ns}/services`);
    return (response.items || []).map(mapService);
  }

  async getIngresses(config: K8sConfig, namespace?: string) {
    const ns = namespace || config.namespace || 'default';
    const response = await this.request(
      config,
      `/apis/networking.k8s.io/v1/namespaces/${ns}/ingresses`
    );
    return (response.items || []).map(mapIngress);
  }

  async getPods(config: K8sConfig, namespace?: string) {
    const ns = namespace || config.namespace || 'default';
    const response = await this.request(config, `/api/v1/namespaces/${ns}/pods`);
    return (response.items || []).map(mapPod);
  }

  async getDeployments(config: K8sConfig, namespace?: string) {
    const ns = namespace || config.namespace || 'default';
    const response = await this.request(
      config,
      `/apis/apps/v1/namespaces/${ns}/deployments`
    );
    return (response.items || []).map(mapDeployment);
  }

  async getEvents(config: K8sConfig, namespace?: string, limit = 50) {
    const ns = namespace || config.namespace || 'default';
    const response = await this.request(
      config,
      `/api/v1/namespaces/${ns}/events?limit=${limit}`
    );
    return (response.items || []).map(mapEvent);
  }

  async getCronJobs(config: K8sConfig, namespace?: string): Promise<K8sCronJob[]> {
    // If a specific namespace is given, query only that one
    if (namespace) {
      const response = await this.request(
        config,
        `/apis/batch/v1/namespaces/${namespace}/cronjobs`
      );
      return (response.items || []).map(mapCronJob);
    }

    // If the config has a specific namespace, use that
    if (config.namespace) {
      const response = await this.request(
        config,
        `/apis/batch/v1/namespaces/${config.namespace}/cronjobs`
      );
      return (response.items || []).map(mapCronJob);
    }

    // No namespace specified: iterate all non-system namespaces
    const systemNamespaces = new Set([
      'kube-system', 'kube-public', 'kube-node-lease',
      'ingress-nginx', 'cert-manager', 'opentelemetry-operator-system',
    ]);

    const namespacesResponse = await this.request(config, '/api/v1/namespaces');
    const allNamespaces: string[] = (namespacesResponse.items || [])
      .map((ns: any) => ns.metadata?.name as string)
      .filter((ns: string) => ns && !systemNamespaces.has(ns));

    const allCronJobs: K8sCronJob[] = [];
    for (const ns of allNamespaces) {
      try {
        const response = await this.request(
          config,
          `/apis/batch/v1/namespaces/${ns}/cronjobs`
        );
        const cronJobs = (response.items || []).map(mapCronJob);
        allCronJobs.push(...cronJobs);
      } catch {
        // Skip namespaces that fail
      }
    }
    return allCronJobs;
  }

  async getNamespaces(config: K8sConfig) {
    const response = await this.request(config, '/api/v1/namespaces');
    return (response.items || []).map(mapNamespace);
  }

  async getClusterInfo(config: K8sConfig): Promise<K8sClusterInfo> {
    const [version, nodesResponse] = await Promise.all([
      this.request(config, '/version'),
      this.request(config, '/api/v1/nodes'),
    ]);

    const nodes = (nodesResponse.items || []).map((node: any) => {
      const conditions = node.status?.conditions || [];
      const readyCondition = conditions.find((c: any) => c.type === 'Ready');
      const status = readyCondition?.status === 'True' ? 'Ready' : 'NotReady';

      const roles: string[] = [];
      const labels = node.metadata?.labels || {};
      for (const key of Object.keys(labels)) {
        if (key.startsWith('node-role.kubernetes.io/')) {
          roles.push(key.replace('node-role.kubernetes.io/', ''));
        }
      }
      if (roles.length === 0) roles.push('worker');

      return {
        name: node.metadata?.name || '',
        status,
        roles,
        kubeletVersion: node.status?.nodeInfo?.kubeletVersion || '',
        os: node.status?.nodeInfo?.operatingSystem || '',
        arch: node.status?.nodeInfo?.architecture || '',
      };
    });

    return {
      version: version.gitVersion || '',
      platform: version.platform || '',
      nodeCount: nodes.length,
      nodes,
    };
  }

  async getPodMetrics(config: K8sConfig, namespace?: string): Promise<K8sPodMetrics[] | null> {
    const ns = namespace || config.namespace || 'default';
    try {
      const response = await this.request(
        config,
        `/apis/metrics.k8s.io/v1beta1/namespaces/${ns}/pods`
      );
      return (response.items || []).map((item: any) => ({
        name: item.metadata?.name || '',
        namespace: item.metadata?.namespace || ns,
        timestamp: item.timestamp || '',
        containers: (item.containers || []).map((c: any) => ({
          name: c.name || '',
          cpu: c.usage?.cpu || '0',
          memory: c.usage?.memory || '0',
        })),
      }));
    } catch (err: any) {
      // Metrics server not installed or not available — return null
      if (err.message?.includes('404') || err.message?.includes('not found') || err.message?.includes('the server could not find')) {
        log.info({ namespace: ns }, 'Metrics server not available');
        return null;
      }
      throw err;
    }
  }

  async getEventsForPod(config: K8sConfig, namespace: string, podName: string) {
    const fieldSelector = encodeURIComponent(`involvedObject.name=${podName},involvedObject.kind=Pod`);
    const response = await this.request(
      config,
      `/api/v1/namespaces/${namespace}/events?fieldSelector=${fieldSelector}`
    );
    return (response.items || []).map(mapEvent);
  }

  async restartDeployment(config: K8sConfig, namespace: string, deploymentName: string) {
    const patch = {
      spec: {
        template: {
          metadata: {
            annotations: {
              'kubectl.kubernetes.io/restartedAt': new Date().toISOString(),
            },
          },
        },
      },
    };

    return this.requestWithBody(
      config,
      `/apis/apps/v1/namespaces/${namespace}/deployments/${deploymentName}`,
      'PATCH',
      patch,
      'application/strategic-merge-patch+json'
    );
  }
}
