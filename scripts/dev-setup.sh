#!/bin/bash
set -e

echo "=== OpsBoard Development Setup ==="

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Node.js is required but not installed."; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "pnpm is required. Install with: npm i -g pnpm"; exit 1; }

# Install dependencies
echo "Installing dependencies..."
pnpm install

# Create data directory
mkdir -p ~/.opsboard
echo "Created ~/.opsboard directory"

# Generate database migrations
echo "Setting up database..."
cd packages/backend
pnpm db:generate 2>/dev/null || echo "Migrations already up to date"
cd ../..

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Start development:"
echo "  pnpm dev:backend    # Start backend on port 19876"
echo "  pnpm dev:desktop    # Start frontend on port 5173"
echo ""
echo "Or start both:"
echo "  pnpm dev"
