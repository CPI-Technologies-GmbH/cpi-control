import { eq } from 'drizzle-orm';
import { appSettings } from '../../db/schema.js';
import type { DB } from '../../db/client.js';

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULTS: Record<string, string> = {
  logBufferSize: '10000',
};

const VALIDATORS: Record<string, (v: string) => boolean> = {
  logBufferSize: (v) => {
    const n = parseInt(v, 10);
    return !isNaN(n) && n >= 1000 && n <= 100000;
  },
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AppSettingsMap {
  logBufferSize: number;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class SettingsService {
  private db: DB;

  constructor(db: DB) {
    this.db = db;
  }

  /** Get all settings as a typed map. */
  getAll(): AppSettingsMap {
    const rows = this.db.select().from(appSettings).all();
    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.key] = row.value;
    }

    return {
      logBufferSize: parseInt(map.logBufferSize ?? DEFAULTS.logBufferSize, 10),
    };
  }

  /** Get a single setting value, returning the default if not set. */
  get(key: string): string {
    const row = this.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, key))
      .get();
    return row?.value ?? DEFAULTS[key] ?? '';
  }

  /** Update one or more settings. Returns the updated settings map. */
  update(updates: Partial<Record<string, string | number>>): AppSettingsMap {
    const now = new Date().toISOString();

    for (const [key, rawValue] of Object.entries(updates)) {
      if (rawValue === undefined || rawValue === null) continue;

      const value = String(rawValue);
      const validator = VALIDATORS[key];
      if (validator && !validator(value)) {
        throw new Error(`Invalid value for setting "${key}": ${value}`);
      }

      // Upsert
      const existing = this.db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, key))
        .get();

      if (existing) {
        this.db
          .update(appSettings)
          .set({ value, updatedAt: now })
          .where(eq(appSettings.key, key))
          .run();
      } else {
        this.db
          .insert(appSettings)
          .values({ key, value, updatedAt: now })
          .run();
      }
    }

    return this.getAll();
  }
}
