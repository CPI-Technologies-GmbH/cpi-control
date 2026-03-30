export interface DeploymentQueryParams {
  serviceId?: string;
  projectId?: string;
  provider?: string | string[];
  status?: string | string[];
  environment?: string | string[];
  branch?: string;
  since?: string;
  limit?: string;
  offset?: string;
}

export type CorrelationRule =
  | 'deployment_then_down'
  | 'build_green_deploy_red'
  | 'rollback_detected'
  | 'multiple_rapid_deploys'
  | 'deploy_during_incident';

export interface DeploymentCorrelation {
  rule: CorrelationRule;
  deploymentId: string;
  relatedEntityId?: string;
  confidence: number; // 0-1
  message: string;
  detectedAt: string;
}

export interface AggregatedDeploymentStats {
  totalDeployments: number;
  successCount: number;
  failedCount: number;
  averageBuildDurationMs: number;
  averageDeployDurationMs: number;
  deploymentsLast24h: number;
  correlations: DeploymentCorrelation[];
}
