import { eq, desc, gte, and } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import {
  healthCheckResults,
  deploymentRecords,
  incidents,
  websites,
  infrastructureBindings,
  repositoryBindings,
  monitoringTargets,
} from '../../db/schema.js';

// Tool definitions for OpenAI function calling
export const TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_health_history',
      description:
        'Get recent health check results for a service. Returns status, response time, status codes, and error messages.',
      parameters: {
        type: 'object',
        properties: {
          websiteId: { type: 'string', description: 'The service ID' },
          limit: {
            type: 'number',
            description: 'Number of recent results to return (default 20)',
          },
          since: {
            type: 'string',
            description: 'ISO 8601 timestamp to filter results from',
          },
        },
        required: ['websiteId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_recent_deployments',
      description:
        'Get recent deployment records for a service. Returns deployment status, commit info, build/deploy duration.',
      parameters: {
        type: 'object',
        properties: {
          websiteId: { type: 'string', description: 'The service ID' },
          limit: {
            type: 'number',
            description: 'Number of recent deployments to return (default 10)',
          },
        },
        required: ['websiteId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_service_info',
      description:
        'Get full service configuration including infrastructure bindings, repository bindings, and monitoring targets.',
      parameters: {
        type: 'object',
        properties: {
          websiteId: { type: 'string', description: 'The service ID' },
        },
        required: ['websiteId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_open_incidents',
      description: 'Get all open or recent incidents for a service.',
      parameters: {
        type: 'object',
        properties: {
          websiteId: { type: 'string', description: 'The service ID' },
          includeResolved: {
            type: 'boolean',
            description: 'Include recently resolved incidents (default false)',
          },
        },
        required: ['websiteId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'check_http_endpoint',
      description:
        'Perform a live HTTP check against a URL and return status code, response time, headers.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to check' },
          method: {
            type: 'string',
            description: 'HTTP method (default GET)',
            enum: ['GET', 'HEAD', 'POST'],
          },
          timeoutMs: {
            type: 'number',
            description: 'Request timeout in milliseconds (default 10000)',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'analyze_response_times',
      description:
        'Analyze response time trends for a service. Returns average, p50, p95, p99, and trend direction.',
      parameters: {
        type: 'object',
        properties: {
          websiteId: { type: 'string', description: 'The service ID' },
          periodHours: {
            type: 'number',
            description: 'Time period to analyze in hours (default 24)',
          },
        },
        required: ['websiteId'],
      },
    },
  },
];

// Tool execution functions
export function createToolExecutors(db: DB) {
  return {
    get_health_history: async (args: {
      websiteId: string;
      limit?: number;
      since?: string;
    }) => {
      const conditions = [eq(healthCheckResults.websiteId, args.websiteId)];
      if (args.since) {
        conditions.push(gte(healthCheckResults.checkedAt, args.since));
      }

      const results = db
        .select()
        .from(healthCheckResults)
        .where(and(...conditions))
        .orderBy(desc(healthCheckResults.checkedAt))
        .limit(args.limit || 20)
        .all();

      return {
        count: results.length,
        results: results.map((r) => ({
          status: r.status,
          statusCode: r.statusCode,
          responseTimeMs: r.responseTimeMs,
          errorMessage: r.errorMessage,
          checkedAt: r.checkedAt,
        })),
      };
    },

    get_recent_deployments: async (args: { websiteId: string; limit?: number }) => {
      const results = db
        .select()
        .from(deploymentRecords)
        .where(eq(deploymentRecords.websiteId, args.websiteId))
        .orderBy(desc(deploymentRecords.createdAt))
        .limit(args.limit || 10)
        .all();

      return {
        count: results.length,
        deployments: results.map((d) => ({
          id: d.id,
          provider: d.provider,
          status: d.status,
          environment: d.environment,
          branch: d.branch,
          commitSha: d.commitSha,
          commitMessage: d.commitMessage,
          author: d.author,
          buildDurationMs: d.buildDurationMs,
          deployDurationMs: d.deployDurationMs,
          startedAt: d.startedAt,
          completedAt: d.completedAt,
        })),
      };
    },

    get_service_info: async (args: { websiteId: string }) => {
      const site = db
        .select()
        .from(websites)
        .where(eq(websites.id, args.websiteId))
        .all()[0];

      if (!site) return { error: 'Service not found' };

      const infra = db
        .select()
        .from(infrastructureBindings)
        .where(eq(infrastructureBindings.websiteId, args.websiteId))
        .all();

      const repos = db
        .select()
        .from(repositoryBindings)
        .where(eq(repositoryBindings.websiteId, args.websiteId))
        .all();

      const targets = db
        .select()
        .from(monitoringTargets)
        .where(eq(monitoringTargets.websiteId, args.websiteId))
        .all();

      return {
        service: {
          id: site.id,
          name: site.name,
          url: site.url,
          environment: site.environment,
          hostingType: site.hostingType,
          status: site.status,
          healthCheckUrl: site.healthCheckUrl,
        },
        infrastructureBindings: infra,
        repositoryBindings: repos,
        monitoringTargets: targets,
      };
    },

    get_open_incidents: async (args: {
      websiteId: string;
      includeResolved?: boolean;
    }) => {
      let allIncidents;
      if (args.includeResolved) {
        allIncidents = db
          .select()
          .from(incidents)
          .where(eq(incidents.websiteId, args.websiteId))
          .orderBy(desc(incidents.detectedAt))
          .limit(10)
          .all();
      } else {
        allIncidents = db
          .select()
          .from(incidents)
          .where(
            and(
              eq(incidents.websiteId, args.websiteId),
              eq(incidents.status, 'open')
            )
          )
          .orderBy(desc(incidents.detectedAt))
          .all();
      }

      return {
        count: allIncidents.length,
        incidents: allIncidents.map((i) => ({
          id: i.id,
          title: i.title,
          severity: i.severity,
          status: i.status,
          detectedAt: i.detectedAt,
          resolvedAt: i.resolvedAt,
          rootCause: i.rootCause,
        })),
      };
    },

    check_http_endpoint: async (args: {
      url: string;
      method?: string;
      timeoutMs?: number;
    }) => {
      const start = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          args.timeoutMs || 10000
        );

        const response = await fetch(args.url, {
          method: args.method || 'GET',
          signal: controller.signal,
          redirect: 'follow',
        });

        clearTimeout(timeout);
        const responseTimeMs = Date.now() - start;

        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });

        return {
          statusCode: response.status,
          statusText: response.statusText,
          responseTimeMs,
          headers: {
            'content-type': headers['content-type'],
            server: headers['server'],
            'x-powered-by': headers['x-powered-by'],
            'cache-control': headers['cache-control'],
          },
          redirected: response.redirected,
          finalUrl: response.url,
        };
      } catch (err: any) {
        return {
          error: err.message,
          responseTimeMs: Date.now() - start,
          statusCode: null,
        };
      }
    },

    analyze_response_times: async (args: {
      websiteId: string;
      periodHours?: number;
    }) => {
      const hours = args.periodHours || 24;
      const since = new Date(
        Date.now() - hours * 60 * 60 * 1000
      ).toISOString();

      const results = db
        .select()
        .from(healthCheckResults)
        .where(
          and(
            eq(healthCheckResults.websiteId, args.websiteId),
            gte(healthCheckResults.checkedAt, since)
          )
        )
        .orderBy(healthCheckResults.checkedAt)
        .all();

      const responseTimes = results
        .filter((r) => r.responseTimeMs !== null)
        .map((r) => r.responseTimeMs!);

      if (responseTimes.length === 0) {
        return { error: 'No response time data available for the given period' };
      }

      const sorted = [...responseTimes].sort((a, b) => a - b);
      const avg = Math.round(
        responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      );
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      const p99 = sorted[Math.floor(sorted.length * 0.99)];

      // Simple trend: compare first half vs second half
      const mid = Math.floor(responseTimes.length / 2);
      const firstHalf =
        responseTimes.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
      const secondHalf =
        responseTimes.slice(mid).reduce((a, b) => a + b, 0) /
        (responseTimes.length - mid);
      const trendDirection =
        secondHalf > firstHalf * 1.2
          ? 'increasing'
          : secondHalf < firstHalf * 0.8
            ? 'decreasing'
            : 'stable';

      return {
        periodHours: hours,
        dataPoints: responseTimes.length,
        averageMs: avg,
        p50Ms: p50,
        p95Ms: p95,
        p99Ms: p99,
        minMs: sorted[0],
        maxMs: sorted[sorted.length - 1],
        trend: trendDirection,
      };
    },
  };
}
