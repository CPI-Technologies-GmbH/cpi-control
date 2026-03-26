#!/usr/bin/env node
/**
 * Bundle the backend for Tauri sidecar distribution.
 * Runs tsup, copies native modules and creates the sidecar directory.
 * Works on macOS, Linux, and Windows.
 */
import { execSync } from 'child_process';
import { cpSync, mkdirSync, existsSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BACKEND = join(ROOT, 'packages', 'backend');
const TAURI = join(ROOT, 'apps', 'desktop', 'src-tauri');
const OUTPUT = join(TAURI, 'backend');

console.log('=== Bundling backend for Tauri ===');

// 1. Build backend with tsup
console.log('→ Running tsup...');
execSync('npx tsup', { cwd: BACKEND, stdio: 'inherit' });

// 2. Prepare output directory
console.log('→ Preparing output directory...');
if (existsSync(OUTPUT)) rmSync(OUTPUT, { recursive: true });
mkdirSync(join(OUTPUT, 'node_modules'), { recursive: true });

// 3. Copy bundled code (skip test files)
console.log('→ Copying bundle...');
const distDir = join(BACKEND, 'dist');
for (const file of readdirSync(distDir)) {
  if (file === '__tests__' || file === 'test' || file.endsWith('.test.js')) continue;
  cpSync(join(distDir, file), join(OUTPUT, file), { recursive: true });
}

// 4. Copy native modules
const NATIVE_MODULES = [
  'better-sqlite3', 'bindings', 'file-uri-to-path',
  'keytar', 'node-ssh', 'ssh2', 'cpu-features',
];

console.log('→ Copying native modules...');

// Try local backend node_modules first, then monorepo root
const moduleSources = [
  join(BACKEND, 'node_modules'),
  join(ROOT, 'node_modules'),
];

for (const mod of NATIVE_MODULES) {
  let found = false;

  // Direct node_modules
  for (const source of moduleSources) {
    const modPath = join(source, mod);
    if (existsSync(modPath)) {
      console.log(`  → ${mod} (from ${source})`);
      cpSync(modPath, join(OUTPUT, 'node_modules', mod), { recursive: true });
      found = true;
      break;
    }
  }

  // pnpm virtual store
  if (!found) {
    const pnpmStore = join(ROOT, 'node_modules', '.pnpm');
    if (existsSync(pnpmStore)) {
      for (const entry of readdirSync(pnpmStore)) {
        if (entry.startsWith(mod + '@') || entry === mod) {
          const candidate = join(pnpmStore, entry, 'node_modules', mod);
          if (existsSync(candidate)) {
            console.log(`  → ${mod} (from pnpm store)`);
            cpSync(candidate, join(OUTPUT, 'node_modules', mod), { recursive: true });
            found = true;
            break;
          }
        }
      }
    }
  }

  if (!found) {
    console.log(`  ⚠ ${mod} not found (may not be needed on this platform)`);
  }
}

// 5. Create package.json
writeFileSync(
  join(OUTPUT, 'package.json'),
  JSON.stringify({
    name: 'opsboard-backend-bundle',
    version: '0.1.0',
    type: 'module',
    private: true,
  }, null, 2),
);

// 6. Copy drizzle migrations
const drizzleDir = join(BACKEND, 'drizzle');
if (existsSync(drizzleDir)) {
  console.log('→ Copying drizzle migrations...');
  cpSync(drizzleDir, join(OUTPUT, 'drizzle'), { recursive: true });
}

// Summary
const files = [];
function countFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) countFiles(join(dir, entry.name));
    else files.push(join(dir, entry.name));
  }
}
countFiles(OUTPUT);

console.log('');
console.log('=== Backend bundle complete ===');
console.log(`  Output: ${OUTPUT}`);
console.log(`  Files: ${files.length}`);
