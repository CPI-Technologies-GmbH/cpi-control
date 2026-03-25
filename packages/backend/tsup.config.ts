import { defineConfig } from 'tsup';

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
    // Bundle everything else (pure JS deps)
  ],
  banner: {
    // ESM compat: provide __dirname and __filename
    js: `import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);`,
  },
});
