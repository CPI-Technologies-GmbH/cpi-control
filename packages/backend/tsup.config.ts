import { defineConfig } from 'tsup';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: false,
  splitting: false, // Single output file for sidecar distribution
  // Native modules must be external — they can't be bundled
  external: [
    'better-sqlite3',
    'keytar',
    'node-ssh',
    'cpu-features',
  ],
  noExternal: [
    // Bundle ALL pure-JS deps into the single output file
    // (external list above still takes precedence for native modules)
    /.*/,
  ],
  define: {
    'process.env.APP_VERSION': JSON.stringify(pkg.version),
  },
  banner: {
    // ESM compat: provide __dirname and __filename
    // Use aliased import to avoid colliding with source-level `dirname` imports
    js: `import { createRequire as __cjsCreateRequire } from 'module';
import { fileURLToPath as __cjsFileURLToPath } from 'url';
import { dirname as __cjsDirname } from 'path';
const require = __cjsCreateRequire(import.meta.url);
const __filename = __cjsFileURLToPath(import.meta.url);
const __dirname = __cjsDirname(__filename);`,
  },
});
