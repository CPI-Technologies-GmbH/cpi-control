#!/usr/bin/env bash
# Bundle the backend for Tauri sidecar distribution.
# This script:
# 1. Bundles TS code with tsup (native modules externalized)
# 2. Copies native .node bindings
# 3. Creates a minimal package.json for native module resolution
# 4. Places everything in apps/desktop/src-tauri/backend/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/packages/backend"
TAURI_DIR="$ROOT_DIR/apps/desktop/src-tauri"
OUTPUT_DIR="$TAURI_DIR/backend"

echo "=== Bundling backend for Tauri ==="

# 1. Build backend bundle with tsup
echo "→ Running tsup..."
cd "$BACKEND_DIR"
npx tsup

# 2. Prepare output directory
echo "→ Preparing output directory..."
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/node_modules"

# 3. Copy bundled code
echo "→ Copying bundle..."
cp "$BACKEND_DIR/dist/index.js" "$OUTPUT_DIR/index.js"

# 4. Copy native modules (better-sqlite3, keytar, etc.)
echo "→ Copying native modules..."

# better-sqlite3
if [ -d "$BACKEND_DIR/node_modules/better-sqlite3" ]; then
  cp -r "$BACKEND_DIR/node_modules/better-sqlite3" "$OUTPUT_DIR/node_modules/"
fi

# bindings (needed by better-sqlite3)
if [ -d "$BACKEND_DIR/node_modules/bindings" ]; then
  cp -r "$BACKEND_DIR/node_modules/bindings" "$OUTPUT_DIR/node_modules/"
fi

# file-uri-to-path (needed by bindings)
if [ -d "$BACKEND_DIR/node_modules/file-uri-to-path" ]; then
  cp -r "$BACKEND_DIR/node_modules/file-uri-to-path" "$OUTPUT_DIR/node_modules/"
fi

# prebuild-install + dependencies (for native module loading)
if [ -d "$BACKEND_DIR/node_modules/prebuild-install" ]; then
  cp -r "$BACKEND_DIR/node_modules/prebuild-install" "$OUTPUT_DIR/node_modules/"
fi

# keytar
if [ -d "$BACKEND_DIR/node_modules/keytar" ]; then
  cp -r "$BACKEND_DIR/node_modules/keytar" "$OUTPUT_DIR/node_modules/"
fi

# node-ssh and its native deps (ssh2)
if [ -d "$BACKEND_DIR/node_modules/node-ssh" ]; then
  cp -r "$BACKEND_DIR/node_modules/node-ssh" "$OUTPUT_DIR/node_modules/"
fi
if [ -d "$BACKEND_DIR/node_modules/ssh2" ]; then
  cp -r "$BACKEND_DIR/node_modules/ssh2" "$OUTPUT_DIR/node_modules/"
fi
if [ -d "$BACKEND_DIR/node_modules/cpu-features" ]; then
  cp -r "$BACKEND_DIR/node_modules/cpu-features" "$OUTPUT_DIR/node_modules/"
fi

# Also check monorepo root node_modules (pnpm hoisting)
MONO_MODULES="$ROOT_DIR/node_modules"
for mod in better-sqlite3 bindings file-uri-to-path keytar node-ssh ssh2 cpu-features; do
  if [ ! -d "$OUTPUT_DIR/node_modules/$mod" ] && [ -d "$MONO_MODULES/.pnpm" ]; then
    # Find in pnpm store
    FOUND=$(find "$MONO_MODULES/.pnpm" -maxdepth 2 -name "$mod" -type d 2>/dev/null | head -1)
    if [ -n "$FOUND" ] && [ -d "$FOUND/node_modules/$mod" ]; then
      echo "  → Copying $mod from pnpm store"
      cp -r "$FOUND/node_modules/$mod" "$OUTPUT_DIR/node_modules/"
    elif [ -n "$FOUND" ]; then
      echo "  → Copying $mod from pnpm flat"
      cp -r "$FOUND" "$OUTPUT_DIR/node_modules/"
    fi
  fi
done

# 5. Create minimal package.json for module resolution
cat > "$OUTPUT_DIR/package.json" << 'PKGJSON'
{
  "name": "opsboard-backend-bundle",
  "version": "0.1.0",
  "type": "module",
  "private": true
}
PKGJSON

# 6. Copy drizzle migrations if they exist
if [ -d "$BACKEND_DIR/drizzle" ]; then
  echo "→ Copying drizzle migrations..."
  cp -r "$BACKEND_DIR/drizzle" "$OUTPUT_DIR/"
fi

# Calculate size
BUNDLE_SIZE=$(du -sh "$OUTPUT_DIR" | cut -f1)
echo ""
echo "=== Backend bundle complete ==="
echo "  Output: $OUTPUT_DIR"
echo "  Size: $BUNDLE_SIZE"
echo "  Files: $(find "$OUTPUT_DIR" -type f | wc -l | tr -d ' ')"
