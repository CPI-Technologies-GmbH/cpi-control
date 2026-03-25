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
const RESTART_DELAY_MS = 5000;

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
}

// ─── LogCollector ────────────────────────────────────────────────────────────

export class LogCollector {
  private db: DB;
  private secretStore: SecretStore;
  private settingsService: SettingsService;
  private namespaceProcesses: Map<string, NamespaceProcess> = new Map();
  private _buffer: RingBuffer<LogEntry>;
  private running = false;
  private kubeconfigPath: string | null = null;
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

    // Check stern exists
    try {
      fs.accessSync(STERN_PATH, fs.constants.X_OK);
    } catch {
      log.warn('stern not found at %s — LogCollector will not collect Kubernetes logs', STERN_PATH);
      return;
    }

    // Write kubeconfig to temp file
    const kubeconfigContent = await this.secretStore.get('kubeconfig');
    if (!kubeconfigContent) {
      log.warn('No kubeconfig found — LogCollector will not collect Kubernetes logs');
      return;
    }

    this.kubeconfigPath = path.join(os.tmpdir(), `opsboard-collector-kubeconfig-${Date.now()}`);
    fs.writeFileSync(this.kubeconfigPath, kubeconfigContent, { mode: 0o600 });

    // Discover namespaces from infrastructure bindings
    const namespaces = this.discoverNamespaces();

    if (namespaces.length === 0) {
      log.info('No active K8s namespaces found — starting with --all-namespaces');
      this.spawnSternForNamespace('__all__');
    } else {
      log.info({ namespaces }, 'Starting stern processes for %d namespaces', namespaces.length);
      for (const ns of namespaces) {
        this.spawnSternForNamespace(ns);
      }
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    log.info('Stopping LogCollector — killing %d stern processes', this.namespaceProcesses.size);

    for (const [ns, state] of this.namespaceProcesses) {
      if (state.restartTimer) clearTimeout(state.restartTimer);
      if (state.process && !state.process.killed) {
        state.process.kill('SIGTERM');
      }
    }
    this.namespaceProcesses.clear();

    // Clean up kubeconfig temp file
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

  private discoverNamespaces(): string[] {
    try {
      const bindings = this.db
        .select({ externalId: infrastructureBindings.externalId })
        .from(infrastructureBindings)
        .where(eq(infrastructureBindings.provider, 'kubernetes'))
        .all();

      const namespaces = new Set<string>();
      for (const binding of bindings) {
        // externalId format is "namespace/name"
        const slashIdx = binding.externalId.indexOf('/');
        if (slashIdx > 0) {
          namespaces.add(binding.externalId.slice(0, slashIdx));
        }
      }
      return Array.from(namespaces);
    } catch (err: any) {
      log.error({ error: err.message }, 'Failed to discover namespaces');
      return [];
    }
  }

  private spawnSternForNamespace(namespace: string): void {
    if (!this.running || !this.kubeconfigPath) return;

    const isAllNamespaces = namespace === '__all__';
    const args = isAllNamespaces
      ? ['--all-namespaces', '--output', 'json', '--tail', '100', '.*']
      : ['--namespace', namespace, '--output', 'json', '--tail', '100', '.*'];

    log.info({ namespace: isAllNamespaces ? '*' : namespace }, 'Spawning stern process');

    const proc = spawn(STERN_PATH, args, {
      env: { ...process.env, KUBECONFIG: this.kubeconfigPath! },
    });

    const state: NamespaceProcess = {
      namespace,
      process: proc,
      tmpKubeconfigPath: this.kubeconfigPath!,
    };

    this.namespaceProcesses.set(namespace, state);

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
        log.debug({ namespace: isAllNamespaces ? '*' : namespace, stderr: msg.slice(0, 200) }, 'stern stderr');
      }
    });

    proc.on('close', (code) => {
      log.warn(
        { namespace: isAllNamespaces ? '*' : namespace, code },
        'stern process exited'
      );
      this.namespaceProcesses.delete(namespace);

      // Auto-restart if still running
      if (this.running) {
        log.info(
          { namespace: isAllNamespaces ? '*' : namespace, delayMs: RESTART_DELAY_MS },
          'Scheduling stern restart'
        );
        const timer = setTimeout(() => {
          this.spawnSternForNamespace(namespace);
        }, RESTART_DELAY_MS);
        // Store timer in a temporary entry so it can be cleared on stop
        this.namespaceProcesses.set(namespace, {
          ...state,
          process: proc,
          restartTimer: timer,
        });
      }
    });

    proc.on('error', (err) => {
      log.error(
        { namespace: isAllNamespaces ? '*' : namespace, error: err.message },
        'stern process error'
      );
    });
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
      message,
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
