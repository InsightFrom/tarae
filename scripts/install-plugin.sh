#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
set -e

# Define directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_PLUGIN_DIR="$WORKSPACE_DIR/packages/tarae-plugin"
DEST_PLUGIN_DIR="$HOME/.gemini/config/plugins/tarae-plugin"

echo "================================================"
echo "🧶 Installing Tarae Skill Plugin globally..."
echo "================================================"

# Validate source directory exists
if [ ! -d "$SRC_PLUGIN_DIR" ]; then
    echo "❌ Error: Source plugin directory does not exist: $SRC_PLUGIN_DIR"
    exit 1
fi

# Clean or create target directories
echo "🧹 Preparing destination directory..."
mkdir -p "$DEST_PLUGIN_DIR/skills/tarae"

# Copy files
echo "📦 Copying plugin files..."
cp "$SRC_PLUGIN_DIR/plugin.json" "$DEST_PLUGIN_DIR/plugin.json"
cp "$SRC_PLUGIN_DIR/skills/tarae/SKILL.md" "$DEST_PLUGIN_DIR/skills/tarae/SKILL.md"

# Verify files are successfully installed
if [ -f "$DEST_PLUGIN_DIR/plugin.json" ] && [ -f "$DEST_PLUGIN_DIR/skills/tarae/SKILL.md" ]; then
    echo "================================================"
    echo "✨ Tarae Skill Plugin successfully installed!"
    echo "================================================"
    echo "Plugin Path: $DEST_PLUGIN_DIR"
    echo "SKILL Path:  $DEST_PLUGIN_DIR/skills/tarae/SKILL.md"
    echo "================================================"
else
    echo "❌ Error: Installation verification failed!"
    exit 1
fi
