import { createChildLogger } from '../../shared/logger.js';
import type { DB } from '../../db/client.js';
import type { SecretStore } from '../secrets/keychain.js';
import type { LogCollector } from './collector.js';
import { spawn, type ChildProcess } from 'child_process';
import { ulid } from 'ulid';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { remoteAgents, websites, infrastructureBindings } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import type { LogEntry, LogFilter, LogLevel, LogSource, LogSourceInfo } from './types.js';

const log = createChildLogger('log-service');

const STERN_PATH = '/opt/homebrew/bin/stern';
const MAX_BUFFER_SIZE = 1000;
const DEFAULT_LIMIT = 200;
const DEFAULT_SINCE = '1h';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Convert a duration string like "1h", "30m", "2d" to milliseconds. */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 60 * 60 * 1000; // default 1h
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      return 60 * 60 * 1000;
  }
}

/** Determine whether a "since" value is an ISO date string or a duration. */
function resolveSince(since: string | undefined): string {
  if (!since) return DEFAULT_SINCE;
  // If it looks like a duration (e.g. "1h", "30m"), return as-is for stern.
  if (/^\d+(s|m|h|d)$/.test(since)) return since;
  // Otherwise treat as ISO timestamp and convert to a duration stern understands.
  try {
    const date = new Date(since);
    const diffMs = Date.now() - date.getTime();
    if (diffMs <= 0) return '1m';
    const diffSeconds = Math.ceil(diffMs / 1000);
    return `${diffSeconds}s`;
  } catch {
    return DEFAULT_SINCE;
  }
}

/** Map a pino log level number to our LogLevel type. */
function pinoLevelToLogLevel(level: number | string): LogLevel {
  if (typeof level === 'string') {
    if (['debug', 'info', 'warn', 'error'].includes(level)) return level as LogLevel;
    return 'info';
  }
  if (level <= 20) return 'debug';
  if (level <= 30) return 'info';
  if (level <= 40) return 'warn';
  return 'error';
}

/** Map journalctl priority to LogLevel. */
function journalPriorityToLogLevel(priority: string | number): LogLevel {
  const p = typeof priority === 'string' ? parseInt(priority, 10) : priority;
  if (p <= 3) return 'error';
  if (p <= 4) return 'warn';
  if (p <= 6) return 'info';
  return 'debug';
}

/** Check whether a log entry passes the given filter. */
function matchesFilter(entry: LogEntry, filter: LogFilter): boolean {
  // Source filter
  if (filter.source) {
    const raw = Array.isArray(filter.source) ? filter.source : filter.source.split(',');
    const sources = raw.map((s: string) => s.trim());
    if (!sources.includes(entry.source)) return false;
  }

  // Level filter
  if (filter.level) {
    const raw = Array.isArray(filter.level) ? filter.level : filter.level.split(',');
    const levels = raw.map((l: string) => l.trim());
    if (!levels.includes(entry.level)) return false;
  }

  // Time range filters
  if (filter.since) {
    if (/^\d+(s|m|h|d)$/.test(filter.since)) {
      const cutoff = Date.now() - parseDuration(filter.since);
      if (new Date(entry.timestamp).getTime() < cutoff) return false;
    } else {
      if (entry.timestamp < filter.since) return false;
    }
  }
  if (filter.until) {
    if (entry.timestamp > filter.until) return false;
  }

  // Text search
  if (filter.search) {
    const term = filter.search.toLowerCase();
    const haystack = `${entry.message} ${JSON.stringify(entry.metadata ?? {})}`.toLowerCase();
    if (!haystack.includes(term)) return false;
  }

  // Namespace / pod metadata filters
  if (filter.namespace && entry.metadata?.namespace !== filter.namespace) return false;
  if (filter.pod && entry.metadata?.pod !== filter.pod) return false;

  // Service-name metadata filter (set by resolveServiceK8sBinding during log fetching)
  if (filter._serviceName) {
    const svcName = filter._serviceName.toLowerCase();
    // For agent logs, check agentName or message for the service name
    if (entry.source === 'agent') {
      const agentName = String(entry.metadata?.agentName ?? '').toLowerCase();
      const message = entry.message.toLowerCase();
      if (!agentName.includes(svcName) && !message.includes(svcName)) return false;
    }
  }

  return true;
}

// ─── LogService ─────────────────────────────────────────────────────────────

export class LogService {
  private secretStore: SecretStore;
  private db: DB;
  private logBuffer: LogEntry[] = [];
  private sternProcess?: ChildProcess;
  private _logCollector: LogCollector | null = null;

  constructor(db: DB, secretStore: SecretStore) {
    this.db = db;
    this.secretStore = secretStore;
  }

  /** Attach a LogCollector for reading K8s logs from the background buffer. */
  setLogCollector(collector: LogCollector): void {
    this._logCollector = collector;
  }

  // ── Aggregated Queries ──────────────────────────────────────────────────

  /**
   * Fetch logs from all requested sources in parallel and merge by timestamp
   * (newest first).
   */
  async getLogs(rawFilter: LogFilter): Promise<LogEntry[]> {
    const filter = await this.resolveServiceFilter(rawFilter);
    const sources = this.resolveRequestedSources(filter);
    const limit = filter.limit ?? DEFAULT_LIMIT;

    const fetchers: Promise<LogEntry[]>[] = [];

    if (sources.includes('kubernetes')) {
      if (this._logCollector) {
        // Read from background collector buffer (instant)
        fetchers.push(Promise.resolve(this.getKubernetesLogsFromBuffer(filter)));
      } else {
        // Fallback: spawn stern on demand
        fetchers.push(this.getKubernetesLogs(filter).catch((err) => {
          log.error({ error: err.message }, 'Failed to fetch Kubernetes logs');
          return [] as LogEntry[];
        }));
      }
    }
    if (sources.includes('agent')) {
      fetchers.push(this.getAgentLogs(filter).catch((err) => {
        log.error({ error: err.message }, 'Failed to fetch agent logs');
        return [] as LogEntry[];
      }));
    }
    if (sources.includes('backend')) {
      fetchers.push(Promise.resolve(this.getBackendLogs(filter)));
    }

    // Vercel and GitHub are stubs for now — return empty arrays.
    if (sources.includes('vercel')) {
      fetchers.push(Promise.resolve([]));
    }
    if (sources.includes('github')) {
      fetchers.push(Promise.resolve([]));
    }

    const results = await Promise.all(fetchers);
    const merged = results.flat();

    // Sort newest first
    merged.sort((a, b) => (b.timestamp > a.timestamp ? 1 : b.timestamp < a.timestamp ? -1 : 0));

    return merged.slice(0, limit);
  }

  // ── Source Availability ─────────────────────────────────────────────────

  async getLogSources(): Promise<LogSourceInfo[]> {
    const [kubeconfigExists, sternExists, agentCount, vercelTokenExists, githubTokenExists] =
      await Promise.all([
        this.secretStore.get('kubeconfig').then(async (v) => {
          if (v !== null) return true;
          // Check for named kubeconfigs (kubeconfig:*)
          const keys = await this.secretStore.list();
          return keys.some((k: string) => k.startsWith('kubeconfig:'));
        }),
        this.checkFileExists(STERN_PATH),
        this.countAgents(),
        this.secretStore.get('vercel_token').then((v) => v !== null),
        this.secretStore.get('github_token').then((v) => v !== null),
      ]);

    return [
      {
        id: 'kubernetes',
        name: 'Kubernetes',
        type: 'kubernetes' as LogSource,
        available: kubeconfigExists && sternExists,
        description: 'Container logs via stern',
      },
      {
        id: 'agent',
        name: 'Remote Agents',
        type: 'agent' as LogSource,
        available: agentCount > 0,
        description: 'Logs from remote OpsBoard agents via SSH',
      },
      {
        id: 'backend',
        name: 'Backend',
        type: 'backend' as LogSource,
        available: true,
        description: 'OpsBoard backend application logs',
      },
      {
        id: 'vercel',
        name: 'Vercel',
        type: 'vercel' as LogSource,
        available: vercelTokenExists,
        description: 'Vercel deployment and runtime logs',
      },
      {
        id: 'github',
        name: 'GitHub',
        type: 'github' as LogSource,
        available: githubTokenExists,
        description: 'GitHub Actions workflow logs',
      },
    ];
  }

  // ── Kubernetes (from collector buffer) ──────────────────────────────────

  /** Read K8s logs from the background collector's in-memory buffer. */
  private getKubernetesLogsFromBuffer(filter: LogFilter): LogEntry[] {
    if (!this._logCollector) return [];
    const limit = filter.limit ?? DEFAULT_LIMIT;
    const allEntries = this._logCollector.buffer.getAll();

    // Filter entries
    const filtered = allEntries.filter((entry) => matchesFilter(entry, filter));

    // Sort newest first and apply limit
    filtered.sort((a, b) =>
      b.timestamp > a.timestamp ? 1 : b.timestamp < a.timestamp ? -1 : 0
    );
    return filtered.slice(0, limit);
  }

  // ── Kubernetes (stern on-demand fallback) ─────────────────────────────

  async getKubernetesLogs(filter: LogFilter): Promise<LogEntry[]> {
    const kubeconfigContent = await this.secretStore.get('kubeconfig');
    if (!kubeconfigContent) {
      log.warn('No kubeconfig found in secret store — skipping Kubernetes logs');
      return [];
    }

    const tmpFile = path.join(os.tmpdir(), `opsboard-kubeconfig-${Date.now()}`);
    fs.writeFileSync(tmpFile, kubeconfigContent, { mode: 0o600 });

    try {
      const since = resolveSince(filter.since);
      const podFilter = filter.pod ?? '.*';
      const limit = filter.limit ?? DEFAULT_LIMIT;

      const args = ['--all-namespaces', '--output', 'json', '--no-follow', '--since', since];

      if (filter.namespace) {
        // Replace --all-namespaces with specific namespace
        args[0] = '--namespace';
        args.splice(1, 0, filter.namespace);
      }

      args.push(podFilter);

      const entries = await this.runSternCollect(args, tmpFile, limit, filter);
      return entries;
    } finally {
      this.cleanupTmpFile(tmpFile);
    }
  }

  // ── Agent Logs via SSH ──────────────────────────────────────────────────

  async getAgentLogs(filter: LogFilter): Promise<LogEntry[]> {
    const agents = this.db.select().from(remoteAgents).all();

    if (agents.length === 0) return [];

    const limit = filter.limit ?? DEFAULT_LIMIT;
    const perAgentLimit = Math.max(Math.ceil(limit / agents.length), 50);

    const allEntries: LogEntry[] = [];

    await Promise.all(
      agents.map(async (agent) => {
        try {
          const entries = await this.fetchAgentLogs(agent, perAgentLimit, filter);
          allEntries.push(...entries);
        } catch (err: any) {
          log.error(
            { agentId: agent.id, host: agent.host, error: err.message },
            'Failed to fetch logs from agent'
          );
        }
      })
    );

    return allEntries;
  }

  // ── Backend Logs (in-memory ring buffer) ────────────────────────────────

  getBackendLogs(filter: LogFilter): LogEntry[] {
    const limit = filter.limit ?? DEFAULT_LIMIT;
    const filtered = this.logBuffer.filter((entry) => matchesFilter(entry, filter));
    // logBuffer is stored oldest-first, return newest-first
    return filtered.slice(-limit).reverse();
  }

  // ── Streaming (SSE / AsyncGenerator) ────────────────────────────────────

  async *streamLogs(rawFilter: LogFilter): AsyncGenerator<LogEntry> {
    const filter = await this.resolveServiceFilter(rawFilter);
    const sources = this.resolveRequestedSources(filter);

    // Track last emitted backend log index so we can poll for new ones.
    let lastBackendIndex = this.logBuffer.length;

    // Track collector buffer position for K8s live tail
    let lastCollectorIndex = this._logCollector ? this._logCollector.buffer.currentIndex : 0;
    const useCollectorForK8s = sources.includes('kubernetes') && this._logCollector !== null;

    // Yield initial batch of recent entries so the client gets immediate data
    const INITIAL_BATCH_SIZE = 100;

    if (useCollectorForK8s && this._logCollector) {
      const recentK8s = this._logCollector.buffer.getLast(INITIAL_BATCH_SIZE);
      for (const entry of recentK8s) {
        if (matchesFilter(entry, filter)) {
          yield entry;
        }
      }
    }

    if (sources.includes('backend')) {
      const startIdx = Math.max(0, this.logBuffer.length - INITIAL_BATCH_SIZE);
      for (let i = startIdx; i < this.logBuffer.length; i++) {
        const entry = this.logBuffer[i];
        if (matchesFilter(entry, filter)) {
          yield entry;
        }
      }
      lastBackendIndex = this.logBuffer.length;
    }

    // Stern streaming (only new entries via --tail 0) — fallback when no collector
    let sternStream: AsyncGenerator<LogEntry> | null = null;
    if (sources.includes('kubernetes') && !this._logCollector) {
      try {
        sternStream = this.streamKubernetesLogs(filter);
      } catch (err: any) {
        log.error({ error: err.message }, 'Failed to start Kubernetes log stream');
      }
    }

    // Agent log polling interval (every 10 seconds)
    const agentPollIntervalMs = 10_000;
    let lastAgentPoll = Date.now();
    let lastAgentTimestamp = new Date().toISOString();

    try {
      while (true) {
        // Yield stern entries if available
        if (sternStream) {
          // We use a non-blocking approach: attempt to get next value with a timeout.
          const next = await Promise.race([
            sternStream.next(),
            this.delay(1000).then(() => ({ value: undefined, done: false as const })),
          ]);
          if (next.value) {
            if (matchesFilter(next.value, filter)) {
              yield next.value;
            }
          }
          if (next.done) {
            sternStream = null;
          }
        }

        // Yield new K8s entries from collector buffer (live tail)
        if (useCollectorForK8s && this._logCollector) {
          const newEntries = this._logCollector.buffer.getAfter(lastCollectorIndex);
          lastCollectorIndex = this._logCollector.buffer.currentIndex;
          for (const entry of newEntries) {
            if (matchesFilter(entry, filter)) {
              yield entry;
            }
          }
        }

        // Yield new backend log entries
        if (sources.includes('backend')) {
          while (lastBackendIndex < this.logBuffer.length) {
            const entry = this.logBuffer[lastBackendIndex];
            lastBackendIndex++;
            if (matchesFilter(entry, filter)) {
              yield entry;
            }
          }
        }

        // Poll agent logs periodically
        if (sources.includes('agent') && Date.now() - lastAgentPoll >= agentPollIntervalMs) {
          lastAgentPoll = Date.now();
          try {
            const agentFilter: LogFilter = {
              ...filter,
              since: lastAgentTimestamp,
              limit: 100,
            };
            const agentEntries = await this.getAgentLogs(agentFilter);
            for (const entry of agentEntries) {
              if (matchesFilter(entry, filter)) {
                yield entry;
              }
            }
            if (agentEntries.length > 0) {
              lastAgentTimestamp = agentEntries[0].timestamp; // newest
            }
          } catch (err: any) {
            log.error({ error: err.message }, 'Failed to poll agent logs during stream');
          }
        }

        // If no stern stream, just wait briefly before next poll cycle.
        if (!sternStream) {
          await this.delay(1000);
        }
      }
    } finally {
      // Consumer broke the loop — clean up.
      if (sternStream) {
        await sternStream.return(undefined);
      }
    }
  }

  // ── Backend Log Ingestion ───────────────────────────────────────────────

  /** Push a backend pino log entry into the in-memory ring buffer. */
  pushBackendLog(entry: LogEntry): void {
    this.logBuffer.push(entry);
    if (this.logBuffer.length > MAX_BUFFER_SIZE) {
      this.logBuffer.splice(0, this.logBuffer.length - MAX_BUFFER_SIZE);
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────

  cleanup(): void {
    if (this.sternProcess) {
      log.info('Killing stern process');
      this.sternProcess.kill('SIGTERM');
      this.sternProcess = undefined;
    }
  }

  // ── Private Helpers ─────────────────────────────────────────────────────

  private resolveRequestedSources(filter: LogFilter): LogSource[] {
    if (!filter.source) {
      return ['kubernetes', 'agent', 'backend'];
    }
    return Array.isArray(filter.source) ? filter.source : [filter.source];
  }

  /** Run stern in non-follow mode and collect entries up to the limit. */
  private runSternCollect(
    args: string[],
    kubeconfigPath: string,
    limit: number,
    filter: LogFilter
  ): Promise<LogEntry[]> {
    return new Promise((resolve, reject) => {
      const entries: LogEntry[] = [];
      let stderr = '';

      const proc = spawn(STERN_PATH, args, {
        env: { ...process.env, KUBECONFIG: kubeconfigPath },
      });

      let buffer = '';

      proc.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            const entry = this.sternJsonToLogEntry(parsed);
            if (matchesFilter(entry, filter)) {
              entries.push(entry);
            }
          } catch {
            // Non-JSON line from stern — skip.
          }
        }
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        // Process any remaining buffered data
        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer);
            const entry = this.sternJsonToLogEntry(parsed);
            if (matchesFilter(entry, filter)) {
              entries.push(entry);
            }
          } catch {
            // ignore
          }
        }

        if (code !== 0 && code !== null && entries.length === 0) {
          log.warn({ code, stderr: stderr.slice(0, 500) }, 'stern exited with non-zero code');
        }

        // Sort newest first and apply limit
        entries.sort((a, b) =>
          b.timestamp > a.timestamp ? 1 : b.timestamp < a.timestamp ? -1 : 0
        );
        resolve(entries.slice(0, limit));
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn stern: ${err.message}`));
      });
    });
  }

  /** Spawn stern in follow mode and yield entries as they arrive. */
  private async *streamKubernetesLogs(filter: LogFilter): AsyncGenerator<LogEntry> {
    const kubeconfigContent = await this.secretStore.get('kubeconfig');
    if (!kubeconfigContent) return;

    const tmpFile = path.join(os.tmpdir(), `opsboard-kubeconfig-stream-${Date.now()}`);
    fs.writeFileSync(tmpFile, kubeconfigContent, { mode: 0o600 });

    const podFilter = filter.pod ?? '.*';
    const args = ['--all-namespaces', '--output', 'json', '--tail', '0'];

    if (filter.namespace) {
      args[0] = '--namespace';
      args.splice(1, 0, filter.namespace);
    }

    args.push(podFilter);

    const proc = spawn(STERN_PATH, args, {
      env: { ...process.env, KUBECONFIG: tmpFile },
    });

    this.sternProcess = proc;

    // Create a line-based async iterable from stdout.
    const lineQueue: string[] = [];
    let lineResolve: (() => void) | null = null;
    let streamDone = false;

    let buffer = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) {
          lineQueue.push(line);
          if (lineResolve) {
            lineResolve();
            lineResolve = null;
          }
        }
      }
    });

    proc.on('close', () => {
      streamDone = true;
      if (lineResolve) {
        lineResolve();
        lineResolve = null;
      }
      this.cleanupTmpFile(tmpFile);
      if (this.sternProcess === proc) {
        this.sternProcess = undefined;
      }
    });

    proc.on('error', (err) => {
      log.error({ error: err.message }, 'stern stream process error');
      streamDone = true;
      if (lineResolve) {
        lineResolve();
        lineResolve = null;
      }
    });

    try {
      while (!streamDone) {
        if (lineQueue.length === 0) {
          await new Promise<void>((resolve) => {
            lineResolve = resolve;
          });
        }

        while (lineQueue.length > 0) {
          const line = lineQueue.shift()!;
          try {
            const parsed = JSON.parse(line);
            yield this.sternJsonToLogEntry(parsed);
          } catch {
            // skip non-JSON
          }
        }
      }
    } finally {
      if (!proc.killed) {
        proc.kill('SIGTERM');
      }
      this.cleanupTmpFile(tmpFile);
      if (this.sternProcess === proc) {
        this.sternProcess = undefined;
      }
    }
  }

  /** Map a stern JSON object to a LogEntry. */
  private sternJsonToLogEntry(data: Record<string, unknown>): LogEntry {
    const message = typeof data.message === 'string' ? data.message : JSON.stringify(data.message);

    // Try to extract log level from the message content
    let level: LogLevel = 'info';
    const msgLower = message.toLowerCase();
    if (msgLower.includes('"level":"error"') || msgLower.includes('error')) level = 'error';
    else if (msgLower.includes('"level":"warn"') || msgLower.includes('warn')) level = 'warn';
    else if (msgLower.includes('"level":"debug"') || msgLower.includes('debug')) level = 'debug';

    return {
      id: ulid(),
      timestamp: new Date().toISOString(),
      source: 'kubernetes',
      level,
      message,
      metadata: {
        pod: (data.podName as string) ?? undefined,
        namespace: (data.namespace as string) ?? undefined,
        container: (data.containerName as string) ?? undefined,
        node: (data.nodeName as string) ?? undefined,
      },
    };
  }

  /** Fetch logs from a single remote agent via SSH + journalctl. */
  private async fetchAgentLogs(
    agent: { id: string; name: string; host: string; port: number | null; username: string },
    limit: number,
    filter: LogFilter
  ): Promise<LogEntry[]> {
    const { NodeSSH } = await import('node-ssh');
    const ssh = new NodeSSH();

    try {
      await ssh.connect({
        host: agent.host,
        port: agent.port ?? 22,
        username: agent.username,
        privateKeyPath: path.join(os.homedir(), '.ssh', 'id_rsa'),
      });

      const sinceArg = this.buildJournalctlSince(filter.since);
      const cmd = `journalctl -u opsboard-agent --no-pager -n ${limit} --output json ${sinceArg}`;

      const result = await ssh.execCommand(cmd);
      ssh.dispose();

      if (result.code !== 0 && result.code !== null) {
        log.warn(
          { agentId: agent.id, stderr: result.stderr.slice(0, 300) },
          'journalctl returned non-zero exit code'
        );
      }

      const entries: LogEntry[] = [];
      const lines = result.stdout.split('\n');

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const entry: LogEntry = {
            id: ulid(),
            timestamp: this.journalTimestampToISO(parsed.__REALTIME_TIMESTAMP ?? parsed._SOURCE_REALTIME_TIMESTAMP),
            source: 'agent',
            level: journalPriorityToLogLevel(parsed.PRIORITY ?? '6'),
            message: (parsed.MESSAGE as string) ?? '',
            metadata: {
              agentId: agent.id,
              agentName: agent.name,
              node: agent.host,
            },
          };

          if (matchesFilter(entry, filter)) {
            entries.push(entry);
          }
        } catch {
          // Skip non-JSON lines
        }
      }

      return entries;
    } catch (err: any) {
      ssh.dispose();
      throw err;
    }
  }

  /** Convert journalctl realtime timestamp (microseconds since epoch) to ISO string. */
  private journalTimestampToISO(ts: string | undefined): string {
    if (!ts) return new Date().toISOString();
    const microseconds = parseInt(ts, 10);
    if (isNaN(microseconds)) return new Date().toISOString();
    return new Date(microseconds / 1000).toISOString();
  }

  /** Build --since flag for journalctl from our filter.since format. */
  private buildJournalctlSince(since: string | undefined): string {
    if (!since) return '--since "1 hour ago"';
    if (/^\d+s$/.test(since)) return `--since "${parseInt(since)} seconds ago"`;
    if (/^\d+m$/.test(since)) return `--since "${parseInt(since)} minutes ago"`;
    if (/^\d+h$/.test(since)) return `--since "${parseInt(since)} hours ago"`;
    if (/^\d+d$/.test(since)) return `--since "${parseInt(since)} days ago"`;
    // Assume ISO 8601
    return `--since "${since}"`;
  }

  private async checkFileExists(filePath: string): Promise<boolean> {
    try {
      fs.accessSync(filePath, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  private countAgents(): number {
    const rows = this.db.select().from(remoteAgents).all();
    return rows.length;
  }

  private cleanupTmpFile(filePath: string): void {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Ignore — file may already be deleted.
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Look up the Kubernetes namespace and deployment name for a given service ID.
   * Returns null if the service doesn't exist or has no Kubernetes binding.
   */
  private async resolveServiceK8sBinding(
    serviceId: string
  ): Promise<{ namespace: string; deploymentName: string; serviceName: string } | null> {
    // Look up the service (website) name
    const service = this.db
      .select({ id: websites.id, name: websites.name })
      .from(websites)
      .where(eq(websites.id, serviceId))
      .get();

    if (!service) {
      log.warn({ serviceId }, 'Service not found for log filtering');
      return null;
    }

    // Look up Kubernetes infrastructure binding
    const binding = this.db
      .select()
      .from(infrastructureBindings)
      .where(
        and(
          eq(infrastructureBindings.websiteId, serviceId),
          eq(infrastructureBindings.provider, 'kubernetes')
        )
      )
      .get();

    if (!binding) {
      log.debug({ serviceId, serviceName: service.name }, 'No Kubernetes binding found for service');
      return { namespace: '', deploymentName: '', serviceName: service.name };
    }

    // externalId is the deployment name; metadata may contain namespace
    const namespace = (binding.metadata?.namespace as string) ?? '';
    const deploymentName = binding.externalId;

    return { namespace, deploymentName, serviceName: service.name };
  }

  /**
   * Apply serviceId filter by resolving it to K8s namespace/deployment and
   * enriching the filter object accordingly. Returns the enriched filter.
   */
  private async resolveServiceFilter(filter: LogFilter): Promise<LogFilter> {
    if (!filter.serviceId) return filter;

    const binding = await this.resolveServiceK8sBinding(filter.serviceId);
    if (!binding) return filter;

    const enriched: LogFilter = { ...filter, _serviceName: binding.serviceName };

    // If there is a Kubernetes binding with namespace/deployment, apply as stern filters
    if (binding.namespace) {
      enriched.namespace = enriched.namespace || binding.namespace;
    }
    if (binding.deploymentName) {
      // Use deployment name as pod filter prefix (pods are usually named <deployment>-<hash>)
      enriched.pod = enriched.pod || `${binding.deploymentName}.*`;
    }

    return enriched;
  }
}
