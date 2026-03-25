export interface K8sConfig {
  kubeconfig?: string; // Path to kubeconfig or inline YAML
  context?: string;
  namespace?: string;
  apiServer?: string;
  token?: string;
  caCert?: string; // Base64-encoded CA certificate
  clientCert?: string; // Base64-encoded client certificate
  clientKey?: string; // Base64-encoded client key
}

export interface K8sPod {
  name: string;
  namespace: string;
  status: string; // Running | Pending | Failed | Succeeded | Unknown
  phase: string;
  ready: boolean;
  restartCount: number;
  createdAt: string;
  nodeName: string;
  containers: K8sContainer[];
}

export interface K8sContainer {
  name: string;
  image: string;
  ready: boolean;
  restartCount: number;
  state: string;
}

export interface K8sDeployment {
  name: string;
  namespace: string;
  replicas: number;
  readyReplicas: number;
  availableReplicas: number;
  updatedReplicas: number;
  conditions: K8sCondition[];
  createdAt: string;
}

export interface K8sCondition {
  type: string;
  status: string;
  reason: string;
  message: string;
  lastTransitionTime: string;
}

export interface K8sEvent {
  type: string;
  reason: string;
  message: string;
  involvedObject: {
    kind: string;
    name: string;
    namespace: string;
  };
  firstTimestamp: string;
  lastTimestamp: string;
  count: number;
}

export interface K8sService {
  name: string;
  namespace: string;
  type: string; // ClusterIP | NodePort | LoadBalancer | ExternalName
  clusterIP: string;
  ports: { port: number; targetPort: number | string; protocol: string; name?: string }[];
  selector: Record<string, string>;
  createdAt: string;
}

export interface K8sIngress {
  name: string;
  namespace: string;
  hosts: string[];
  paths: { host: string; path: string; serviceName: string; servicePort: number | string }[];
  tlsHosts: string[];
  createdAt: string;
}

export interface K8sCronJob {
  name: string;
  namespace: string;
  schedule: string;
  suspended: boolean;
  lastScheduleTime: string | null;
  activeJobs: number;
  createdAt: string;
  concurrencyPolicy: string;
  image: string;
}

export interface K8sNamespace {
  name: string;
  status: string;
  labels: Record<string, string>;
  createdAt: string;
}

export interface K8sPodMetrics {
  name: string;
  namespace: string;
  timestamp: string;
  containers: {
    name: string;
    cpu: string;      // e.g. "12m" (millicores)
    memory: string;   // e.g. "64Mi"
  }[];
}

export interface K8sClusterInfo {
  version: string;
  platform: string;
  nodeCount: number;
  nodes: { name: string; status: string; roles: string[]; kubeletVersion: string; os: string; arch: string }[];
}
