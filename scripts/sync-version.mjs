#!/usr/bin/env node
/**
 * sync-version.mjs — Sync version across all package manifests.
 *
 * Usage:
 *   node scripts/sync-version.mjs 0.1.42
 *
 * Updates version in:
 *   - package.json (root)
 *   - packages/backend/package.json
 *   - apps/desktop/package.json
 *   - apps/desktop/src-tauri/tauri.conf.json
 *   - apps/desktop/src-tauri/Cargo.toml
 *   - apps/monitoring-agent/Makefile
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const version = process.argv[2];
if (!version) {
  console.error('Usage: node scripts/sync-version.mjs <version>');
  console.error('Example: node scripts/sync-version.mjs 0.1.42');
  process.exit(1);
}

// Validate semver-ish format
if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`Invalid version format: ${version} (expected X.Y.Z)`);
  process.exit(1);
}

function updateJson(filePath, key = 'version') {
  const abs = resolve(root, filePath);
  const data = JSON.parse(readFileSync(abs, 'utf-8'));
  data[key] = version;
  writeFileSync(abs, JSON.stringify(data, null, 2) + '\n');
  console.log(`  ${filePath} -> ${version}`);
}

function updateTauriConf(filePath) {
  const abs = resolve(root, filePath);
  const data = JSON.parse(readFileSync(abs, 'utf-8'));
  data.version = version;
  writeFileSync(abs, JSON.stringify(data, null, 2) + '\n');
  console.log(`  ${filePath} -> ${version}`);
}

function updateCargoToml(filePath) {
  const abs = resolve(root, filePath);
  let content = readFileSync(abs, 'utf-8');
  content = content.replace(/^version\s*=\s*".*"/m, `version = "${version}"`);
  writeFileSync(abs, content);
  console.log(`  ${filePath} -> ${version}`);
}

function updateMakefile(filePath) {
  const abs = resolve(root, filePath);
  let content = readFileSync(abs, 'utf-8');
  content = content.replace(/^VERSION=.*/m, `VERSION=${version}`);
  writeFileSync(abs, content);
  console.log(`  ${filePath} -> ${version}`);
}

console.log(`Syncing version to ${version}:\n`);

updateJson('package.json');
updateJson('packages/backend/package.json');
updateJson('apps/desktop/package.json');
updateTauriConf('apps/desktop/src-tauri/tauri.conf.json');
updateCargoToml('apps/desktop/src-tauri/Cargo.toml');
updateMakefile('apps/monitoring-agent/Makefile');

console.log('\nDone.');
