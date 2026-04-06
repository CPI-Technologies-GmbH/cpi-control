import { createChildLogger } from '../../shared/logger.js';
import type { DB } from '../../db/client.js';
import type { SecretStore } from '../secrets/keychain.js';
import { SettingsService } from '../settings/service.js';
import { spawn, type ChildProcess } from 'child_process';
import { ulid } from 'ulid';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { infrastructureBindings, websites } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import type { LogEntry, LogLevel } from './types.js';

const log = createChildLogger('log-collector');

const STERN_PATH = '/opt/homebrew/bin/stern';
const DEFAULT_BUFFER_SIZE = 10000;
const RESTART_DELAYS_MS = [5_000, 10_000, 30_000, 60_000, 120_000];
const MAX_RESTART_ATTEMPTS = 5;

// ─── Ring Buffer ─────────────────────────────────────────────────────────────

export class RingBuffer<T> {
  private buffer: T[] = [];
  private _maxSize: number;

  constructor(maxSize: number) {
    this._maxSize = maxSize;
  }

  get maxSize(): number {
    return this._maxSize;
  }

  set maxSize(newSize: number) {
    this._maxSize = newSize;
    if (this.buffer.length > newSize) {
      this.buffer.splice(0, this.buffer.length - newSize);
    }
  }

  push(item: T): void {
    this.buffer.push(item);
    if (this.buffer.length > this._maxSize) {
      this.buffer.splice(0, this.buffer.length - this._maxSize);
    }
  }

  /** Return all items, oldest first. */
  getAll(): T[] {
    return [...this.buffer];
  }

  /** Return the last N items, oldest first. */
  getLast(n: number): T[] {
    if (n >= this.buffer.length) return [...this.buffer];
    return this.buffer.slice(-n);
  }

  get length(): number {
    return this.buffer.length;
  }

  /** Get the index into the underlying array for tracking live tail position. */
  get currentIndex(): number {
    return this.buffer.length;
  }

  /** Get items added after a given index (for live tail). */
  getAfter(index: number): T[] {
    if (index >= this.buffer.length) return [];
    // If items were evicted, the index shifted — clamp to 0
    const effectiveIndex = Math.max(0, index);
    return this.buffer.slice(effectiveIndex);
  }
}

// ─── Namespace Process State ─────────────────────────────────────────────────

interface NamespaceProcess {
  namespace: string;
  process: ChildProcess;
  tmpKubeconfigPath: string;
  restartTimer?: NodeJS.Timeout;
  restartAttempts: number;
}

// ─── LogCollector ────────────────────────────────────────────────────────────

export class LogCollector {
  private db: DB;
  private secretStore: SecretStore;
  private settingsService: SettingsService;
  private namespaceProcesses: Map<string, NamespaceProcess> = new Map();
  private _buffer: RingBuffer<LogEntry>;
  private running = false;
  private healthCheckTimer?: NodeJS.Timeout;
  private kubeconfigPath: string | null = null;
  /** Per-cluster kubeconfig temp file paths */
  private clusterKubeconfigPaths: Map<string, string> = new Map();
  /** Maps container/deployment name → serviceId for enriching log entries. */
  private serviceIdCache: Map<string, string> = new Map();
  private cacheRefreshedAt = 0;
  private static CACHE_TTL_MS = 60_000; // Refresh cache every 60s

  constructor(db: DB, secretStore: SecretStore) {
    this.db = db;
    this.secretStore = secretStore;
    this.settingsService = new SettingsService(db);

    const settings = this.settingsService.getAll();
    this._buffer = new RingBuffer<LogEntry>(settings.logBufferSize || DEFAULT_BUFFER_SIZE);
    this.refreshServiceIdCache();
  }

  get buffer(): RingBuffer<LogEntry> {
    return this._buffer;
  }

  /** Update buffer size from settings (called when settings change). */
  refreshBufferSize(): void {
    const settings = this.settingsService.getAll();
    const newSize = settings.logBufferSize || DEFAULT_BUFFER_SIZE;
    if (this._buffer.maxSize !== newSize) {
      log.info({ oldSize: this._buffer.maxSize, newSize }, 'Updating log buffer size');
      this._buffer.maxSize = newSize;
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    log.info('Starting LogCollector');

    // Kill any orphaned stern processes from previous backend runs
    try {
      const { execSync } = await import('child_process');
      execSync('pkill -9 -f "stern --namespace" 2>/dev/null || true', { stdio: 'ignore', shell: '/bin/bash' });
      execSync('pkill -9 -f "stern --all-namespaces" 2>/dev/null || true', { stdio: 'ignore', shell: '/bin/bash' });
      log.info('Cleaned up orphaned stern processes from previous runs');
    } catch { /* ignore */ }

    // Check stern exists
    try {
      fs.accessSync(STERN_PATH, fs.constants.X_OK);
    } catch {
      log.warn('stern not found at %s — LogCollector will not collect Kubernetes logs', STERN_PATH);
      return;
    }

    try {
      // Collect all available kubeconfigs (plain + named)
      const allKeys = await this.secretStore.list();
      const namedKeys = allKeys.filter((k: string) => k.startsWith('kubeconfig:'));
      log.info({ namedKeys: namedKeys.length }, 'Found %d named kubeconfigs', namedKeys.length);

      // Try plain 'kubeconfig' first
      const plainKubeconfig = await this.secretStore.get('kubeconfig');

      if (!plainKubeconfig && namedKeys.length === 0) {
        log.warn('No kubeconfig found — LogCollector will not collect Kubernetes logs');
        return;
      }

      // Discover which namespaces belong to which cluster
      const clusterNamespaces = this.discoverClusterNamespaces();
      log.info({ clusters: Array.from(clusterNamespaces.entries()).map(([k, v]) => `${k}(${v.length})`) }, 'Discovered cluster-namespace mapping');

      if (plainKubeconfig) {
        // Use plain kubeconfig as default
        this.kubeconfigPath = path.join(os.tmpdir(), `opsboard-collector-kubeconfig-${Date.now()}`);
        fs.writeFileSync(this.kubeconfigPath, plainKubeconfig, { mode: 0o600 });

        const defaultNamespaces = clusterNamespaces.get('__default__') || [];
        if (defaultNamespaces.length > 0) {
          for (const ns of defaultNamespaces) {
            this.spawnSternForNamespace(ns);
          }
        }
      }

      // Start stern for each named kubeconfig — use cluster:namespace as key to avoid collisions
      for (const key of namedKeys) {
        const clusterName = key.replace('kubeconfig:', '');
        const content = await this.secretStore.get(key);
        if (!content) {
          log.warn({ clusterName }, 'Empty kubeconfig for cluster %s', clusterName);
          continue;
        }

        const tmpPath = path.join(os.tmpdir(), `opsboard-collector-kubeconfig-${clusterName.replace(/\s+/g, '-')}-${Date.now()}`);
        fs.writeFileSync(tmpPath, content, { mode: 0o600 });
        this.clusterKubeconfigPaths.set(clusterName, tmpPath);

        const namespaces = clusterNamespaces.get(clusterName) || [];
        if (namespaces.length > 0) {
          log.info({ clusterName, namespaces }, 'Starting stern for cluster %s (%d namespaces)', clusterName, namespaces.length);
          for (const ns of namespaces) {
            // Use unique key: "clusterName::namespace" to avoid collisions across clusters
            this.spawnSternForNamespace(`${clusterName}::${ns}`, tmpPath);
          }
        } else {
          log.info({ clusterName }, 'No specific namespaces for cluster %s — starting with --all-namespaces', clusterName);
          this.spawnSternForNamespace(`__all__:${clusterName}`, tmpPath);
        }
      }

      // If no processes started at all and we have a default kubeconfig, try --all-namespaces
      if (this.namespaceProcesses.size === 0 && this.kubeconfigPath) {
        log.info('No active K8s namespaces found — starting with --all-namespaces');
        this.spawnSternForNamespace('__all__');
      }

      log.info({ processCount: this.namespaceProcesses.size }, 'LogCollector started %d stern processes', this.namespaceProcesses.size);

      // Start periodic health check every 60s
      this.healthCheckTimer = setInterval(() => this.healthCheck(), 60_000);
    } catch (err: any) {
      log.error({ error: err.message, stack: err.stack }, 'LogCollector start() failed');
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }

    log.info('Stopping LogCollector — killing %d stern processes', this.namespaceProcesses.size);

    for (const [, state] of this.namespaceProcesses) {
      if (state.restartTimer) clearTimeout(state.restartTimer);
      if (state.process && !state.process.killed) {
        try { state.process.kill('SIGKILL'); } catch { /* ignore */ }
      }
    }
    this.namespaceProcesses.clear();

    // Belt and suspenders: pkill any orphaned sterns
    try {
      const { execSync } = require('child_process');
      execSync('pkill -9 -f "stern --namespace" 2>/dev/null || true', { stdio: 'ignore', shell: '/bin/bash' });
      execSync('pkill -9 -f "stern --all-namespaces" 2>/dev/null || true', { stdio: 'ignore', shell: '/bin/bash' });
    } catch { /* ignore */ }

    // Clean up kubeconfig temp files
    for (const [, tmpPath] of this.clusterKubeconfigPaths) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
    this.clusterKubeconfigPaths.clear();

    if (this.kubeconfigPath) {
      try {
        fs.unlinkSync(this.kubeconfigPath);
      } catch {
        // ignore
      }
      this.kubeconfigPath = null;
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /** Build a cache mapping container/deployment name → serviceId from infra bindings. */
  private refreshServiceIdCache(): void {
    try {
      const bindings = this.db
        .select({
          websiteId: infrastructureBindings.websiteId,
          externalId: infrastructureBindings.externalId,
        })
        .from(infrastructureBindings)
        .where(eq(infrastructureBindings.provider, 'kubernetes'))
        .all();

      this.serviceIdCache.clear();
      for (const b of bindings) {
        // externalId format: "namespace/deployment-name"
        const slashIdx = b.externalId.indexOf('/');
        if (slashIdx > 0) {
          const deploymentName = b.externalId.slice(slashIdx + 1);
          this.serviceIdCache.set(deploymentName, b.websiteId);
        }
      }
      this.cacheRefreshedAt = Date.now();
      log.debug({ cacheSize: this.serviceIdCache.size }, 'Refreshed serviceId cache');
    } catch (err: any) {
      log.error({ error: err.message }, 'Failed to refresh serviceId cache');
    }
  }

  /** Look up serviceId for a container/pod name. Refreshes cache if stale. */
  private resolveServiceId(containerName?: string, podName?: string): string | undefined {
    if (Date.now() - this.cacheRefreshedAt > LogCollector.CACHE_TTL_MS) {
      this.refreshServiceIdCache();
    }
    // Try exact match on containerName first (most reliable — stern sets this to deployment name)
    if (containerName && this.serviceIdCache.has(containerName)) {
      return this.serviceIdCache.get(containerName);
    }
    // Fallback: match podName prefix against known deployment names
    if (podName) {
      for (const [deploymentName, serviceId] of this.serviceIdCache) {
        if (podName.startsWith(deploymentName + '-')) {
          return serviceId;
        }
      }
    }
    return undefined;
  }

  /** Discover namespaces grouped by cluster name from infrastructure bindings. */
  private discoverClusterNamespaces(): Map<string, string[]> {
    const result = new Map<string, Set<string>>();
    try {
      const bindings = this.db
        .select({
          externalId: infrastructureBindings.externalId,
          metadata: infrastructureBindings.metadata,
        })
        .from(infrastructureBindings)
        .where(eq(infrastructureBindings.provider, 'kubernetes'))
        .all();

      for (const binding of bindings) {
        const slashIdx = binding.externalId.indexOf('/');
        if (slashIdx <= 0) continue;

        const namespace = binding.externalId.slice(0, slashIdx);
        const meta = binding.metadata as Record<string, unknown> | null;
        const clusterName = (meta?.clusterName as string) || '__default__';

        if (!result.has(clusterName)) result.set(clusterName, new Set());
        result.get(clusterName)!.add(namespace);
      }
    } catch (err: any) {
      log.error({ error: err.message }, 'Failed to discover namespaces');
    }

    // Convert Sets to arrays
    const out = new Map<string, string[]>();
    for (const [cluster, nsSet] of result) {
      out.set(cluster, Array.from(nsSet));
    }
    return out;
  }

  private spawnSternForNamespace(namespaceKey: string, kubeconfigOverride?: string, restartAttempts = 0): void {
    const kcPath = kubeconfigOverride || this.kubeconfigPath;
    if (!this.running || !kcPath) return;

    // DEDUPLICATION: Kill any existing process for this namespace before spawning new one
    const existing = this.namespaceProcesses.get(namespaceKey);
    if (existing) {
      if (existing.restartTimer) clearTimeout(existing.restartTimer);
      if (existing.process && !existing.process.killed) {
        try { existing.process.kill('SIGTERM'); } catch { /* ignore */ }
      }
      this.namespaceProcesses.delete(namespaceKey);
    }

    const isAllNamespaces = namespaceKey.startsWith('__all__');
    // Extract actual namespace from key format "clusterName::namespace"
    const actualNamespace = namespaceKey.includes('::') ? namespaceKey.split('::')[1] : namespaceKey;
    const displayNs = isAllNamespaces ? '*' : actualNamespace;
    const args = isAllNamespaces
      ? ['--all-namespaces', '--output', 'json', '--tail', '100', '.*']
      : ['--namespace', actualNamespace, '--output', 'json', '--tail', '100', '.*'];

    log.info({ namespace: displayNs, attempt: restartAttempts }, 'Spawning stern process');

    const proc = spawn(STERN_PATH, args, {
      env: { ...process.env, KUBECONFIG: kcPath },
    });

    const state: NamespaceProcess = {
      namespace: namespaceKey,
      process: proc,
      tmpKubeconfigPath: kcPath,
      restartAttempts,
    };

    this.namespaceProcesses.set(namespaceKey, state);

    let lineBuffer = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const entry = this.parseSternJson(parsed);
          this._buffer.push(entry);
        } catch {
          // Non-JSON output from stern — skip
        }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      const msg = chunk.toString().trim();
      if (msg) {
        log.debug({ namespace: displayNs, stderr: msg.slice(0, 200) }, 'stern stderr');
      }
    });

    proc.on('close', (code, signal) => {
      log.warn({ namespace: displayNs, code, signal, attempt: restartAttempts }, 'stern process died');
      this.namespaceProcesses.delete(namespaceKey);

      // Auto-restart with exponential backoff if still running
      if (!this.running) return;

      const nextAttempt = restartAttempts + 1;
      if (nextAttempt > MAX_RESTART_ATTEMPTS) {
        log.error({ namespace: displayNs, attempts: restartAttempts }, 'Stern crashed too often, giving up');
        return;
      }

      const delay = RESTART_DELAYS_MS[Math.min(nextAttempt - 1, RESTART_DELAYS_MS.length - 1)];
      log.info({ namespace: displayNs, delayMs: delay, attempt: nextAttempt }, 'Scheduling stern restart');

      const timer = setTimeout(() => {
        if (this.running) {
          this.spawnSternForNamespace(namespaceKey, kcPath, nextAttempt);
        }
      }, delay);

      this.namespaceProcesses.set(namespaceKey, {
        ...state,
        process: proc,
        restartTimer: timer,
      });
    });

    proc.on('error', (err) => {
      log.error({ namespace: displayNs, error: err.message }, 'stern process error');
    });
  }

  /** Periodic health check: verify all namespace stern processes are alive. */
  private healthCheck(): void {
    if (!this.running) return;

    let alive = 0;
    let dead = 0;

    for (const [nsKey, state] of this.namespaceProcesses) {
      const isAlive = state.process && !state.process.killed && state.process.exitCode === null;
      const hasPendingRestart = state.restartTimer !== undefined;

      if (isAlive) {
        alive++;
      } else if (!hasPendingRestart) {
        dead++;
        const displayNs = nsKey.includes('::') ? nsKey.split('::')[1] : nsKey;
        log.warn({ namespace: displayNs }, 'Health check: stern process for %s is dead with no restart scheduled — restarting', displayNs);
        this.namespaceProcesses.delete(nsKey);
        this.spawnSternForNamespace(nsKey, state.tmpKubeconfigPath);
      }
    }

    log.debug({ alive, dead, total: this.namespaceProcesses.size }, 'Stern health check: %d alive, %d dead (restarted)', alive, dead);
  }

  /** Strip ANSI escape codes from a string. */
  private stripAnsi(str: string): string {
    // eslint-disable-next-line no-control-regex
    return str.replace(/\x1b\[[0-9;]*m/g, '');
  }

  /** Parse stern JSON output into a LogEntry. */
  private parseSternJson(data: Record<string, unknown>): LogEntry {
    const rawMessage = data.message;
    let message: string;
    let level: LogLevel = 'info';
    let timestamp = new Date().toISOString();

    if (typeof rawMessage === 'string') {
      // Try to parse the message as JSON (structured logs from the container)
      try {
        const innerParsed = JSON.parse(rawMessage);
        message = innerParsed.msg || innerParsed.message || rawMessage;
        if (innerParsed.level) {
          level = this.normalizeLevel(innerParsed.level);
        }
        if (innerParsed.time || innerParsed.timestamp) {
          timestamp = innerParsed.time || innerParsed.timestamp;
        }
      } catch {
        message = rawMessage;
        level = this.inferLevelFromMessage(rawMessage);
      }
    } else {
      message = JSON.stringify(rawMessage);
    }

    const pod = (data.podName as string) ?? undefined;
    const container = (data.containerName as string) ?? undefined;
    const serviceId = this.resolveServiceId(container, pod);

    return {
      id: ulid(),
      timestamp,
      source: 'kubernetes',
      level,
      message: this.stripAnsi(message),
      metadata: {
        pod,
        namespace: (data.namespace as string) ?? undefined,
        container,
        node: (data.nodeName as string) ?? undefined,
        ...(serviceId && { serviceId }),
      },
    };
  }

  /** Normalize a level value (string or number) to our LogLevel type. */
  private normalizeLevel(level: unknown): LogLevel {
    if (typeof level === 'string') {
      const l = level.toLowerCase();
      if (l === 'debug' || l === 'trace' || l === '10' || l === '20') return 'debug';
      if (l === 'info' || l === '30') return 'info';
      if (l === 'warn' || l === 'warning' || l === '40') return 'warn';
      if (l === 'error' || l === 'fatal' || l === '50' || l === '60') return 'error';
      return 'info';
    }
    if (typeof level === 'number') {
      if (level <= 20) return 'debug';
      if (level <= 30) return 'info';
      if (level <= 40) return 'warn';
      return 'error';
    }
    return 'info';
  }

  /** Infer log level from unstructured message text. */
  private inferLevelFromMessage(msg: string): LogLevel {
    const lower = msg.toLowerCase();
    if (lower.includes('error') || lower.includes('fatal') || lower.includes('panic')) return 'error';
    if (lower.includes('warn')) return 'warn';
    if (lower.includes('debug') || lower.includes('trace')) return 'debug';
    return 'info';
  }
}
