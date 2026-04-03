import * as fs from 'fs';
import * as path from 'path';
import { createChildLogger } from '../../shared/logger.js';
import type { LicenseInfo, LicenseLimits, LicenseStatus } from './types.js';
import { FREE_LIMITS, GRACE_PERIOD_DAYS, VALIDATION_INTERVAL_MS, LICENSE_SERVER_URL } from './types.js';

const log = createChildLogger('license-manager');

export class LicenseManager {
  private licenseFilePath: string;
  private license: LicenseInfo | null = null;
  private validationTimer: NodeJS.Timeout | null = null;

  constructor(dataDir: string) {
    this.licenseFilePath = path.join(dataDir, 'license.json');
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  start(): void {
    this.loadFromDisk();
    if (this.license) {
      // Non-blocking validation on startup
      this.validateOnline().catch((err) => {
        log.warn({ error: err.message }, 'Online validation failed on startup — using cached license');
      });
    }
    // Re-validate every 24 hours
    this.validationTimer = setInterval(() => {
      if (this.license) {
        this.validateOnline().catch((err) => {
          log.warn({ error: err.message }, 'Periodic validation failed');
        });
      }
    }, VALIDATION_INTERVAL_MS);
    log.info({ plan: this.license?.plan || 'free', status: this.getStatus() }, 'LicenseManager started');
  }

  stop(): void {
    if (this.validationTimer) {
      clearInterval(this.validationTimer);
      this.validationTimer = null;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────

  async activate(licenseKey: string, machineId: string): Promise<LicenseInfo> {
    const res = await fetch(`${LICENSE_SERVER_URL}/api/license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey, machineId }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Activation failed: HTTP ${res.status}`);
    }

    const data = await res.json();

    this.license = {
      token: data.token,
      plan: data.plan,
      limits: data.limits,
      expiresAt: data.expiresAt,
      lastValidated: new Date().toISOString(),
      offlineSince: null,
      machineId,
    };

    this.saveToDisk();
    log.info({ plan: data.plan }, 'License activated successfully');
    return this.license;
  }

  async deactivate(): Promise<void> {
    if (this.license?.token) {
      try {
        await fetch(`${LICENSE_SERVER_URL}/api/license/deactivate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: this.license.token }),
        });
      } catch (err: any) {
        log.warn({ error: err.message }, 'Deactivation request failed (continuing locally)');
      }
    }

    this.license = null;
    this.deleteFromDisk();
    log.info('License deactivated');
  }

  async forceValidate(): Promise<LicenseInfo | null> {
    return this.validateOnline();
  }

  getLicense(): LicenseInfo | null {
    return this.license;
  }

  getStatus(): LicenseStatus {
    if (!this.license) return 'free';

    // Check expiry
    if (this.license.expiresAt && new Date(this.license.expiresAt) < new Date()) {
      return 'expired';
    }

    // Check offline grace period
    if (this.license.offlineSince) {
      const offlineDays = (Date.now() - new Date(this.license.offlineSince).getTime()) / (24 * 3600_000);
      if (offlineDays > GRACE_PERIOD_DAYS) {
        return 'expired';
      }
      return 'grace';
    }

    return 'active';
  }

  getLimits(): LicenseLimits {
    const status = this.getStatus();
    if (status === 'expired' || !this.license) {
      return FREE_LIMITS;
    }
    return this.license.limits;
  }

  // ── Enforcement (hard) ────────────────────────────────────────────────

  checkServiceLimit(currentCount: number): { allowed: boolean; message?: string } {
    const limits = this.getLimits();
    if (currentCount >= limits.maxServices) {
      const plan = this.license?.plan || 'free';
      return {
        allowed: false,
        message: `Service limit reached (${limits.maxServices} for ${plan.charAt(0).toUpperCase() + plan.slice(1)} plan). Please upgrade to add more integrations.`,
      };
    }
    return { allowed: true };
  }

  checkAgentLimit(currentCount: number): { allowed: boolean; message?: string } {
    const limits = this.getLimits();
    if (currentCount >= limits.maxAgents) {
      const plan = this.license?.plan || 'free';
      return {
        allowed: false,
        message: `Agent limit reached (${limits.maxAgents} for ${plan.charAt(0).toUpperCase() + plan.slice(1)} plan). Please upgrade to add more agents.`,
      };
    }
    return { allowed: true };
  }

  checkStatusPageLimit(currentCount: number): { allowed: boolean; message?: string } {
    const limits = this.getLimits();
    if (currentCount >= limits.maxStatusPages) {
      const plan = this.license?.plan || 'free';
      return {
        allowed: false,
        message: `Status page limit reached (${limits.maxStatusPages} for ${plan.charAt(0).toUpperCase() + plan.slice(1)} plan). Please upgrade to create more status pages.`,
      };
    }
    return { allowed: true };
  }

  // ── Private ───────────────────────────────────────────────────────────

  private async validateOnline(): Promise<LicenseInfo | null> {
    if (!this.license?.token) return null;

    try {
      const res = await fetch(`${LICENSE_SERVER_URL}/api/license/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this.license.token }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        log.warn({ status: res.status, error: body.error }, 'License validation rejected');
        // Don't immediately invalidate — could be temporary server issue
        if (res.status === 404 || res.status === 403) {
          // Token definitely invalid — reset to free
          this.license = null;
          this.deleteFromDisk();
        }
        return this.license;
      }

      const data = await res.json();

      this.license = {
        ...this.license,
        plan: data.plan,
        limits: data.limits,
        expiresAt: data.expiresAt,
        lastValidated: new Date().toISOString(),
        offlineSince: null, // Clear offline flag on successful validation
      };

      this.saveToDisk();
      log.debug({ plan: data.plan }, 'License validated online');
      return this.license;
    } catch (err: any) {
      // Network error — enter offline grace mode
      if (this.license && !this.license.offlineSince) {
        this.license.offlineSince = new Date().toISOString();
        this.saveToDisk();
        log.warn('License server unreachable — entering offline grace period');
      }
      return this.license;
    }
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.licenseFilePath)) {
        const data = JSON.parse(fs.readFileSync(this.licenseFilePath, 'utf-8'));
        this.license = data;
        log.debug({ plan: data.plan }, 'License loaded from disk');
      }
    } catch (err: any) {
      log.warn({ error: err.message }, 'Failed to load license from disk');
    }
  }

  private saveToDisk(): void {
    try {
      fs.writeFileSync(this.licenseFilePath, JSON.stringify(this.license, null, 2));
    } catch (err: any) {
      log.error({ error: err.message }, 'Failed to save license to disk');
    }
  }

  private deleteFromDisk(): void {
    try {
      if (fs.existsSync(this.licenseFilePath)) {
        fs.unlinkSync(this.licenseFilePath);
      }
    } catch (err: any) {
      log.warn({ error: err.message }, 'Failed to delete license file');
    }
  }
}
