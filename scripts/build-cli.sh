#!/bin/bash
set -e

# Get the script directory and repo root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "🧶 Building topa Rust release binary..."
echo "=========================================="
cd "$REPO_ROOT/packages/watcher"
cargo build --release

echo "=========================================="
echo "📝 Setting up packages/cli/.env.local..."
echo "=========================================="
cd "$REPO_ROOT/packages/cli"
echo "TARAE_DEV=true" > .env.local
echo "Saved TARAE_DEV=true into packages/cli/.env.local"

echo "=========================================="
echo "📦 Installing npm dependencies for cli..."
echo "=========================================="
npm install

echo "=========================================="
echo "🔗 Linking CLI globally (npm link)..."
echo "=========================================="
npm link

# Make index.js executable
chmod +x "$REPO_ROOT/packages/cli/bin/index.js"

echo "=========================================="
echo "🎉 CLI Build & Link completed successfully!"
echo "=========================================="
