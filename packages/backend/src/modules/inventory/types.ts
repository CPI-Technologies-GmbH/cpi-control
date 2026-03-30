export interface CreateProjectBody {
  name: string;
  slug: string;
  icon?: string;
  contactEmail?: string;
  contactPhone?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateProjectBody {
  name?: string;
  slug?: string;
  icon?: string;
  contactEmail?: string;
  contactPhone?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export type ServiceType = 'website' | 'service';

export interface CreateServiceBody {
  projectId?: string;
  name: string;
  type?: ServiceType;
  url?: string;
  environment: string;
  hostingType: string;
  healthCheckUrl?: string;
  expectedStatusCode?: number;
  checkIntervalSeconds?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateServiceBody {
  name?: string;
  type?: ServiceType;
  url?: string;
  environment?: string;
  hostingType?: string;
  status?: string;
  healthCheckUrl?: string;
  expectedStatusCode?: number;
  checkIntervalSeconds?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
  projectId?: string | null;
  archived?: boolean;
  mutedUntil?: string | null;
}

export interface BatchUpdateServicesBody {
  ids: string[];
  updates: {
    environment?: string;
    type?: ServiceType;
    hostingType?: string;
    archived?: boolean;
    mutedUntil?: string | null;
  };
}

export interface ServiceQueryParams {
  projectId?: string;
  type?: ServiceType;
  environment?: string;
  hostingType?: string;
  status?: string;
  hasOpenIncident?: string;
  search?: string;
  includeArchived?: string;
  limit?: string;
  offset?: string;
}

export interface CreateMonitoringTargetBody {
  serviceId: string;
  type: string;
  target: string;
  checkIntervalSeconds?: number;
  timeoutMs?: number;
  expectedStatusCode?: number;
  expectedBodyContains?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export interface UpdateMonitoringTargetBody {
  type?: string;
  target?: string;
  checkIntervalSeconds?: number;
  timeoutMs?: number;
  expectedStatusCode?: number;
  expectedBodyContains?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export interface CreateInfraBindingBody {
  serviceId: string;
  provider: string;
  externalId: string;
  region?: string;
  resourceType?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateRepoBindingBody {
  serviceId: string;
  provider: string;
  owner: string;
  repo: string;
  defaultBranch?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateDeploymentSourceBody {
  serviceId: string;
  provider: string;
  externalProjectId?: string;
  pipelineName?: string;
  autoDeploy?: boolean;
  metadata?: Record<string, unknown>;
}
