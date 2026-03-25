import OpenAI from 'openai';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { DB } from '../../db/client.js';
import { diagnosticRuns, websites, incidents } from '../../db/schema.js';
import type { DiagnosticStep } from '../../db/schema.js';
import { SYSTEM_PROMPT, DIAGNOSIS_USER_PROMPT } from './prompts.js';
import { TOOL_DEFINITIONS, createToolExecutors } from './tools.js';
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('ai-diagnostics');

export class DiagnosisOrchestrator {
  private db: DB;
  private openai: OpenAI | null;
  private toolExecutors: ReturnType<typeof createToolExecutors>;

  constructor(db: DB) {
    this.db = db;
    this.toolExecutors = createToolExecutors(db);

    const apiKey = process.env.OPENAI_API_KEY;
    this.openai = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async startDiagnosis(
    serviceId: string,
    trigger: 'manual' | 'automatic' | 'incident',
    incidentId?: string
  ): Promise<{ runId: string }> {
    const now = new Date().toISOString();
    const runId = ulid();

    this.db
      .insert(diagnosticRuns)
      .values({
        id: runId,
        websiteId: serviceId,
        incidentId: incidentId || null,
        status: 'running',
        trigger,
        steps: [],
        startedAt: now,
        createdAt: now,
      })
      .run();

    // Run diagnosis asynchronously
    this.executeDiagnosis(runId, serviceId, incidentId).catch((err) => {
      log.error({ runId, error: err.message }, 'Diagnosis execution failed');
      const failedAt = new Date().toISOString();
      this.db
        .update(diagnosticRuns)
        .set({
          status: 'failed',
          summary: `Diagnosis failed: ${err.message}`,
          completedAt: failedAt,
        })
        .where(eq(diagnosticRuns.id, runId))
        .run();
    });

    return { runId };
  }

  private async executeDiagnosis(
    runId: string,
    serviceId: string,
    incidentId?: string
  ): Promise<void> {
    const startTime = Date.now();

    // Get service info
    const service = this.db
      .select()
      .from(websites)
      .where(eq(websites.id, serviceId))
      .all()[0];

    if (!service) {
      throw new Error('Service not found');
    }

    // Get incident info if applicable
    let incident;
    if (incidentId) {
      const rows = this.db
        .select()
        .from(incidents)
        .where(eq(incidents.id, incidentId))
        .all();
      incident = rows[0];
    }

    if (!this.openai) {
      // Fallback: run basic diagnostics without AI
      await this.runBasicDiagnostics(runId, serviceId, service, startTime);
      return;
    }

    const steps: DiagnosticStep[] = [];
    let totalTokens = 0;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: DIAGNOSIS_USER_PROMPT({
          serviceName: service.name,
          serviceUrl: service.url ?? '',
          currentStatus: service.status,
          incidentTitle: incident?.title,
          incidentSeverity: incident?.severity,
        }),
      },
    ];

    // Function calling loop (max 10 iterations to prevent runaway)
    for (let i = 0; i < 10; i++) {
      const completion = await this.openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        messages,
        tools: TOOL_DEFINITIONS,
        tool_choice: 'auto',
      });

      const message = completion.choices[0].message;
      totalTokens += completion.usage?.total_tokens || 0;
      messages.push(message);

      // If no tool calls, we have the final answer
      if (!message.tool_calls || message.tool_calls.length === 0) {
        // Save final result
        const completedAt = new Date().toISOString();
        const durationMs = Date.now() - startTime;

        const summary = message.content || 'Diagnosis completed without summary.';
        const recommendations = this.extractRecommendations(summary);

        this.db
          .update(diagnosticRuns)
          .set({
            status: 'completed',
            steps,
            summary,
            recommendations,
            tokensUsed: totalTokens,
            durationMs,
            completedAt,
          })
          .where(eq(diagnosticRuns.id, runId))
          .run();

        return;
      }

      // Execute tool calls
      for (const toolCall of message.tool_calls) {
        const fnName = toolCall.function.name;
        const fnArgs = JSON.parse(toolCall.function.arguments);
        const stepStart = Date.now();

        log.info({ runId, tool: fnName, args: fnArgs }, 'Executing diagnostic tool');

        let result: unknown;
        try {
          const executor = this.toolExecutors[fnName as keyof typeof this.toolExecutors];
          if (!executor) {
            result = { error: `Unknown tool: ${fnName}` };
          } else {
            result = await (executor as Function)(fnArgs);
          }
        } catch (err: any) {
          result = { error: err.message };
        }

        const stepDuration = Date.now() - stepStart;
        steps.push({
          tool: fnName,
          input: fnArgs,
          output: result as Record<string, unknown>,
          durationMs: stepDuration,
          timestamp: new Date().toISOString(),
        });

        // Update steps in DB incrementally
        this.db
          .update(diagnosticRuns)
          .set({ steps })
          .where(eq(diagnosticRuns.id, runId))
          .run();

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    }

    // If we hit the loop limit
    const completedAt = new Date().toISOString();
    this.db
      .update(diagnosticRuns)
      .set({
        status: 'completed',
        steps,
        summary: 'Diagnosis completed (reached maximum tool call iterations).',
        tokensUsed: totalTokens,
        durationMs: Date.now() - startTime,
        completedAt,
      })
      .where(eq(diagnosticRuns.id, runId))
      .run();
  }

  private async runBasicDiagnostics(
    runId: string,
    serviceId: string,
    service: any,
    startTime: number
  ): Promise<void> {
    const steps: DiagnosticStep[] = [];

    // Step 1: Check health history
    const healthStep = Date.now();
    const healthData = await this.toolExecutors.get_health_history({
      websiteId: serviceId,
      limit: 10,
    });
    steps.push({
      tool: 'get_health_history',
      input: { serviceId, limit: 10 },
      output: healthData as Record<string, unknown>,
      durationMs: Date.now() - healthStep,
      timestamp: new Date().toISOString(),
    });

    // Step 2: Check recent deployments
    const deployStep = Date.now();
    const deployData = await this.toolExecutors.get_recent_deployments({
      websiteId: serviceId,
      limit: 5,
    });
    steps.push({
      tool: 'get_recent_deployments',
      input: { serviceId, limit: 5 },
      output: deployData as Record<string, unknown>,
      durationMs: Date.now() - deployStep,
      timestamp: new Date().toISOString(),
    });

    // Step 3: HTTP check
    const httpStep = Date.now();
    const httpData = await this.toolExecutors.check_http_endpoint({
      url: service.healthCheckUrl || service.url,
    });
    steps.push({
      tool: 'check_http_endpoint',
      input: { url: service.healthCheckUrl || service.url },
      output: httpData as Record<string, unknown>,
      durationMs: Date.now() - httpStep,
      timestamp: new Date().toISOString(),
    });

    // Build summary
    const healthResults = (healthData as any).results || [];
    const downCount = healthResults.filter((r: any) => r.status === 'down').length;
    const recentDeploys = (deployData as any).deployments || [];
    const failedDeploys = recentDeploys.filter((d: any) => d.status === 'failed');

    let summary = `Basic diagnostic run for ${service.name} (${service.url}).\n`;
    summary += `Health checks: ${healthResults.length} recent, ${downCount} failures.\n`;
    summary += `Recent deployments: ${recentDeploys.length} total, ${failedDeploys.length} failed.\n`;
    summary += `HTTP check: ${(httpData as any).statusCode ? `Status ${(httpData as any).statusCode}, ${(httpData as any).responseTimeMs}ms` : `Error: ${(httpData as any).error}`}.\n`;

    const recommendations: string[] = [];
    if (downCount > 0) {
      recommendations.push('Review health check failures and investigate error patterns.');
    }
    if (failedDeploys.length > 0) {
      recommendations.push('Investigate failed deployments - check build logs and deploy configs.');
    }
    if ((httpData as any).error) {
      recommendations.push(`HTTP endpoint unreachable: ${(httpData as any).error}. Check DNS, SSL, and server status.`);
    }
    if ((httpData as any).responseTimeMs && (httpData as any).responseTimeMs > 5000) {
      recommendations.push('High response time detected. Check server load and database performance.');
    }

    const completedAt = new Date().toISOString();
    this.db
      .update(diagnosticRuns)
      .set({
        status: 'completed',
        steps,
        summary,
        recommendations,
        tokensUsed: 0,
        durationMs: Date.now() - startTime,
        completedAt,
      })
      .where(eq(diagnosticRuns.id, runId))
      .run();
  }

  private extractRecommendations(summary: string): string[] {
    const recommendations: string[] = [];
    const lines = summary.split('\n');
    let inRecommendations = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed.toLowerCase().includes('recommendation') ||
        trimmed.toLowerCase().includes('remediation') ||
        trimmed.toLowerCase().includes('next steps')
      ) {
        inRecommendations = true;
        continue;
      }
      if (inRecommendations && (trimmed.startsWith('-') || trimmed.startsWith('*') || /^\d+\./.test(trimmed))) {
        recommendations.push(trimmed.replace(/^[-*\d.]+\s*/, '').trim());
      }
      if (inRecommendations && trimmed === '' && recommendations.length > 0) {
        inRecommendations = false;
      }
    }

    if (recommendations.length === 0) {
      recommendations.push('Review the diagnosis summary for detailed findings.');
    }

    return recommendations;
  }

  async getRun(runId: string) {
    const rows = this.db
      .select()
      .from(diagnosticRuns)
      .where(eq(diagnosticRuns.id, runId))
      .all();
    return rows[0] || null;
  }

  async listRuns(serviceId?: string, limit = 20) {
    if (serviceId) {
      return this.db
        .select()
        .from(diagnosticRuns)
        .where(eq(diagnosticRuns.websiteId, serviceId))
        .orderBy(diagnosticRuns.createdAt)
        .limit(limit)
        .all();
    }
    return this.db
      .select()
      .from(diagnosticRuns)
      .orderBy(diagnosticRuns.createdAt)
      .limit(limit)
      .all();
  }
}
