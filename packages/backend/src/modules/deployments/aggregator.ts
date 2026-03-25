import { eq, and, desc, gte, sql } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { deploymentRecords, incidents, healthCheckResults, websites } from '../../db/schema.js';
import type { DeploymentCorrelation, AggregatedDeploymentStats } from './types.js';

export class DeploymentAggregator {
  constructor(private db: DB) {}

  async getStats(serviceId?: string): Promise<AggregatedDeploymentStats> {
    const conditions = serviceId ? [eq(deploymentRecords.websiteId, serviceId)] : [];

    const allDeployments = conditions.length
      ? this.db.select().from(deploymentRecords).where(and(...conditions)).all()
      : this.db.select().from(deploymentRecords).all();

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const deploymentsLast24h = allDeployments.filter(
      (d) => d.createdAt >= oneDayAgo
    ).length;

    const successCount = allDeployments.filter((d) => d.status === 'success').length;
    const failedCount = allDeployments.filter((d) => d.status === 'failed').length;

    const buildDurations = allDeployments
      .filter((d) => d.buildDurationMs)
      .map((d) => d.buildDurationMs!);
    const deployDurations = allDeployments
      .filter((d) => d.deployDurationMs)
      .map((d) => d.deployDurationMs!);

    const avgBuild =
      buildDurations.length > 0
        ? Math.round(buildDurations.reduce((a, b) => a + b, 0) / buildDurations.length)
        : 0;
    const avgDeploy =
      deployDurations.length > 0
        ? Math.round(deployDurations.reduce((a, b) => a + b, 0) / deployDurations.length)
        : 0;

    const correlations = await this.detectCorrelations(serviceId);

    return {
      totalDeployments: allDeployments.length,
      successCount,
      failedCount,
      averageBuildDurationMs: avgBuild,
      averageDeployDurationMs: avgDeploy,
      deploymentsLast24h,
      correlations,
    };
  }

  async detectCorrelations(serviceId?: string): Promise<DeploymentCorrelation[]> {
    const correlations: DeploymentCorrelation[] = [];
    const now = new Date();
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();

    // Get recent deployments
    const recentDeploymentsQuery = this.db
      .select()
      .from(deploymentRecords)
      .where(gte(deploymentRecords.createdAt, sixHoursAgo))
      .orderBy(desc(deploymentRecords.createdAt));

    let recentDeployments = recentDeploymentsQuery.all();
    if (serviceId) {
      recentDeployments = recentDeployments.filter((d) => d.websiteId === serviceId);
    }

    // Rule 1: deployment_then_down - service went down shortly after deployment
    for (const deploy of recentDeployments) {
      if (deploy.status !== 'success') continue;
      // Skip deployments not linked to a service
      if (!deploy.websiteId) continue;
      const completedAt = deploy.completedAt || deploy.createdAt;
      const windowEnd = new Date(
        new Date(completedAt).getTime() + 15 * 60 * 1000
      ).toISOString();

      const downChecks = this.db
        .select()
        .from(healthCheckResults)
        .where(
          and(
            eq(healthCheckResults.websiteId, deploy.websiteId),
            eq(healthCheckResults.status, 'down'),
            gte(healthCheckResults.checkedAt, completedAt),
            sql`${healthCheckResults.checkedAt} <= ${windowEnd}`
          )
        )
        .all();

      if (downChecks.length > 0) {
        correlations.push({
          rule: 'deployment_then_down',
          deploymentId: deploy.id,
          relatedEntityId: downChecks[0].id,
          confidence: Math.min(0.5 + downChecks.length * 0.1, 0.95),
          message: `Service went down within 15 minutes of deployment ${deploy.externalId}`,
          detectedAt: now.toISOString(),
        });
      }
    }

    // Rule 2: build_green_deploy_red - build succeeded but deploy failed
    for (const deploy of recentDeployments) {
      if (deploy.status === 'failed' && deploy.buildDurationMs && deploy.buildDurationMs > 0) {
        correlations.push({
          rule: 'build_green_deploy_red',
          deploymentId: deploy.id,
          confidence: 0.85,
          message: `Build completed but deployment failed for ${deploy.externalId}`,
          detectedAt: now.toISOString(),
        });
      }
    }

    // Rule 3: rollback_detected - two deploys on same branch in quick succession where second reverts
    const deploysByService = new Map<string, typeof recentDeployments>();
    for (const d of recentDeployments) {
      // Group by serviceId; skip unlinked deployments for service-based correlations
      const key = d.websiteId || '__unlinked__';
      const arr = deploysByService.get(key) || [];
      arr.push(d);
      deploysByService.set(key, arr);
    }

    for (const [sId, deploys] of deploysByService) {
      for (let i = 0; i < deploys.length - 1; i++) {
        const current = deploys[i];
        const previous = deploys[i + 1];
        if (
          current.branch === previous.branch &&
          current.commitSha &&
          previous.commitSha &&
          current.status === 'success' &&
          previous.status === 'failed'
        ) {
          correlations.push({
            rule: 'rollback_detected',
            deploymentId: current.id,
            relatedEntityId: previous.id,
            confidence: 0.7,
            message: `Possible rollback: deployment ${current.externalId} after failed ${previous.externalId}`,
            detectedAt: now.toISOString(),
          });
        }
      }
    }

    // Rule 4: multiple_rapid_deploys - more than 3 deploys to same service within 1 hour
    for (const [sId, deploys] of deploysByService) {
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
      const recentForSite = deploys.filter((d) => d.createdAt >= oneHourAgo);
      if (recentForSite.length >= 3) {
        correlations.push({
          rule: 'multiple_rapid_deploys',
          deploymentId: recentForSite[0].id,
          confidence: 0.6,
          message: `${recentForSite.length} deployments in the last hour for service`,
          detectedAt: now.toISOString(),
        });
      }
    }

    // Rule 5: deploy_during_incident - deployment happened while an incident was open
    for (const deploy of recentDeployments) {
      // Skip deployments not linked to a service
      if (!deploy.websiteId) continue;

      const openIncidents = this.db
        .select()
        .from(incidents)
        .where(
          and(
            eq(incidents.websiteId, deploy.websiteId),
            eq(incidents.status, 'open'),
            sql`${incidents.detectedAt} <= ${deploy.createdAt}`
          )
        )
        .all();

      if (openIncidents.length > 0) {
        correlations.push({
          rule: 'deploy_during_incident',
          deploymentId: deploy.id,
          relatedEntityId: openIncidents[0].id,
          confidence: 0.8,
          message: `Deployment ${deploy.externalId} occurred during active incident`,
          detectedAt: now.toISOString(),
        });
      }
    }

    return correlations;
  }
}
