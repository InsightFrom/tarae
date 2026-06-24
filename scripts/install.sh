#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${TARAE_REPO_URL:-https://github.com/InsightFrom/tarae.git}"
REF="${TARAE_REF:-main}"
INSTALL_DIR="${TARAE_INSTALL_DIR:-$HOME/.tarae/src/tarae}"
BIN_DIR="${TARAE_BIN_DIR:-$HOME/.tarae/bin}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need git
need node
need npm

echo "Installing Tarae from $REPO_URL ($REF)"
mkdir -p "$BIN_DIR" "$(dirname "$INSTALL_DIR")"

if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" fetch --tags origin
  git -C "$INSTALL_DIR" checkout "$REF"
  git -C "$INSTALL_DIR" pull --ff-only origin "$REF" || true
else
  git clone --branch "$REF" "$REPO_URL" "$INSTALL_DIR"
fi

echo "Installing CLI dependencies"
npm install --omit=dev --prefix "$INSTALL_DIR/packages/cli"

if [ -z "${TARAE_TOPA_DOWNLOAD_BASE_URL:-}" ] && [[ "$REF" == v* ]]; then
  export TARAE_TOPA_DOWNLOAD_BASE_URL="https://github.com/InsightFrom/tarae/releases/download/$REF"
fi

echo "Downloading topa release archive"
TARAE_DEV=false TARAE_FORCE_TOPA_DOWNLOAD=true node "$INSTALL_DIR/packages/cli/bin/index.js" init

cat > "$BIN_DIR/tarae" <<EOF
#!/usr/bin/env bash
exec node "$INSTALL_DIR/packages/cli/bin/index.js" "\$@"
EOF
chmod +x "$BIN_DIR/tarae"

echo
echo "Tarae installed."
echo "Add this to your shell profile if needed:"
echo "  export PATH=\"$BIN_DIR:\$PATH\""
echo
echo "Next:"
echo "  $BIN_DIR/tarae install --agent codex --project-root \"\$PWD\""
echo
echo "Upgrade later:"
echo "  $BIN_DIR/tarae upgrade --ref v0.1.9 --project-root \"\$PWD\""
