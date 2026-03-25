import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type DB = BetterSQLite3Database<typeof schema>;

export function createDatabase(dbPath: string): DB {
  const sqlite = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });

  return db;
}

export function runMigrations(db: DB): void {
  // Auto-create tables from schema (for development / first-run)
  // In production you would use drizzle-kit migrate
  const sqlite = (db as any).session?.client as Database.Database | undefined;
  if (!sqlite) return;

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      contact_email TEXT,
      contact_phone TEXT,
      notes TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS websites (
      id TEXT PRIMARY KEY,
      customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'website',
      url TEXT,
      environment TEXT NOT NULL,
      hosting_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unknown',
      health_check_url TEXT,
      expected_status_code INTEGER DEFAULT 200,
      check_interval_seconds INTEGER DEFAULT 60,
      tags TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS monitoring_targets (
      id TEXT PRIMARY KEY,
      website_id TEXT NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      target TEXT NOT NULL,
      check_interval_seconds INTEGER DEFAULT 60,
      timeout_ms INTEGER DEFAULT 10000,
      expected_status_code INTEGER,
      expected_body_contains TEXT,
      headers TEXT,
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS infrastructure_bindings (
      id TEXT PRIMARY KEY,
      website_id TEXT NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      region TEXT,
      resource_type TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS repository_bindings (
      id TEXT PRIMARY KEY,
      website_id TEXT NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      default_branch TEXT DEFAULT 'main',
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deployment_sources (
      id TEXT PRIMARY KEY,
      website_id TEXT NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      external_project_id TEXT,
      pipeline_name TEXT,
      auto_deploy INTEGER DEFAULT 0,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      website_id TEXT NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      detected_at TEXT NOT NULL,
      acknowledged_at TEXT,
      resolved_at TEXT,
      acknowledged_by TEXT,
      resolved_by TEXT,
      root_cause TEXT,
      summary TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS incident_events (
      id TEXT PRIMARY KEY,
      incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      source TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS diagnostic_runs (
      id TEXT PRIMARY KEY,
      website_id TEXT NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
      incident_id TEXT REFERENCES incidents(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'running',
      trigger TEXT NOT NULL,
      steps TEXT,
      summary TEXT,
      recommendations TEXT,
      tokens_used INTEGER,
      duration_ms INTEGER,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS health_check_results (
      id TEXT PRIMARY KEY,
      website_id TEXT NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
      monitoring_target_id TEXT REFERENCES monitoring_targets(id) ON DELETE SET NULL,
      status TEXT NOT NULL,
      status_code INTEGER,
      response_time_ms INTEGER,
      error_message TEXT,
      checked_at TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deployment_records (
      id TEXT PRIMARY KEY,
      website_id TEXT REFERENCES websites(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      status TEXT NOT NULL,
      environment TEXT,
      branch TEXT,
      commit_sha TEXT,
      commit_message TEXT,
      author TEXT,
      url TEXT,
      build_duration_ms INTEGER,
      deploy_duration_ms INTEGER,
      started_at TEXT,
      completed_at TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS remote_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER DEFAULT 22,
      username TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unknown',
      version TEXT,
      last_heartbeat_at TEXT,
      installed_at TEXT,
      config TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS integration_configs (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      config TEXT,
      last_sync_at TEXT,
      last_sync_status TEXT,
      last_sync_error TEXT,
      sync_interval_seconds INTEGER DEFAULT 300,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      actor TEXT,
      before TEXT,
      after TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      event_type TEXT NOT NULL,
      severity TEXT,
      channel TEXT NOT NULL,
      channel_config TEXT,
      cooldown_minutes INTEGER DEFAULT 15,
      last_notified_at TEXT,
      website_filter TEXT,
      customer_filter TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_websites_customer_id ON websites(customer_id);
    CREATE INDEX IF NOT EXISTS idx_websites_status ON websites(status);
    CREATE INDEX IF NOT EXISTS idx_monitoring_targets_website_id ON monitoring_targets(website_id);
    CREATE INDEX IF NOT EXISTS idx_infrastructure_bindings_website_id ON infrastructure_bindings(website_id);
    CREATE INDEX IF NOT EXISTS idx_repository_bindings_website_id ON repository_bindings(website_id);
    CREATE INDEX IF NOT EXISTS idx_deployment_sources_website_id ON deployment_sources(website_id);
    CREATE INDEX IF NOT EXISTS idx_incidents_website_id ON incidents(website_id);
    CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
    CREATE INDEX IF NOT EXISTS idx_incident_events_incident_id ON incident_events(incident_id);
    CREATE INDEX IF NOT EXISTS idx_diagnostic_runs_website_id ON diagnostic_runs(website_id);
    CREATE INDEX IF NOT EXISTS idx_health_check_results_website_id ON health_check_results(website_id);
    CREATE INDEX IF NOT EXISTS idx_health_check_results_checked_at ON health_check_results(checked_at);
    CREATE INDEX IF NOT EXISTS idx_deployment_records_website_id ON deployment_records(website_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_notification_rules_event_type ON notification_rules(event_type);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS log_view_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      config TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Migration: add type column to existing websites table (idempotent)
  try {
    sqlite.exec(`ALTER TABLE websites ADD COLUMN type TEXT NOT NULL DEFAULT 'website'`);
  } catch (_err) {
    // Column already exists – ignore
  }

  // Migration: make customer_id nullable (SQLite requires table recreation)
  try {
    const custCol = sqlite.prepare(`SELECT "notnull" FROM pragma_table_info('websites') WHERE name='customer_id'`).get() as { notnull: number } | undefined;
    if (custCol && custCol.notnull === 1) {
      sqlite.exec(`
        PRAGMA foreign_keys=OFF;
        BEGIN TRANSACTION;
        CREATE TABLE websites_new2 (
          id TEXT PRIMARY KEY,
          customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'website',
          url TEXT,
          environment TEXT NOT NULL,
          hosting_type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'unknown',
          health_check_url TEXT,
          expected_status_code INTEGER DEFAULT 200,
          check_interval_seconds INTEGER DEFAULT 60,
          tags TEXT,
          metadata TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO websites_new2 SELECT id, customer_id, name, type, url, environment, hosting_type, status, health_check_url, expected_status_code, check_interval_seconds, tags, metadata, created_at, updated_at FROM websites;
        DROP TABLE websites;
        ALTER TABLE websites_new2 RENAME TO websites;
        CREATE INDEX IF NOT EXISTS idx_websites_customer_id ON websites(customer_id);
        CREATE INDEX IF NOT EXISTS idx_websites_status ON websites(status);
        COMMIT;
        PRAGMA foreign_keys=ON;
      `);
    }
  } catch (_err) {
    // Migration already applied or not needed
  }

  // Migration: make url column nullable (SQLite requires table recreation)
  try {
    const urlCol = sqlite.prepare(`SELECT "notnull" FROM pragma_table_info('websites') WHERE name='url'`).get() as { notnull: number } | undefined;
    if (urlCol && urlCol.notnull === 1) {
      sqlite.exec(`
        PRAGMA foreign_keys=OFF;
        BEGIN TRANSACTION;
        CREATE TABLE websites_new (
          id TEXT PRIMARY KEY,
          customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'website',
          url TEXT,
          environment TEXT NOT NULL,
          hosting_type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'unknown',
          health_check_url TEXT,
          expected_status_code INTEGER DEFAULT 200,
          check_interval_seconds INTEGER DEFAULT 60,
          tags TEXT,
          metadata TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO websites_new SELECT id, customer_id, name, type, url, environment, hosting_type, status, health_check_url, expected_status_code, check_interval_seconds, tags, metadata, created_at, updated_at FROM websites;
        DROP TABLE websites;
        ALTER TABLE websites_new RENAME TO websites;
        CREATE INDEX IF NOT EXISTS idx_websites_customer_id ON websites(customer_id);
        CREATE INDEX IF NOT EXISTS idx_websites_status ON websites(status);
        COMMIT;
        PRAGMA foreign_keys=ON;
      `);
    }
  } catch (_err) {
    // Migration already applied or not needed
  }
}
