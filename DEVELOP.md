# Development

Tarae has two runtime components:

- `packages/watcher`: Rust `topa` binary and MCP server
- `packages/cli`: Node.js `tarae` wrapper for install/link/verify flows

## Prerequisites

- Rust stable
- Node.js 18+
- npm

## Repository Setup

```bash
git clone https://github.com/InsightFrom/tarae.git
cd tarae
```

Install CLI dependencies:

```bash
npm install --prefix packages/cli
```

## Build `topa`

```bash
cd packages/watcher
cargo build --release
```

Return to the repository root before running repo-level scripts.

## Build And Link The CLI

```bash
./scripts/build-cli.sh
```

`scripts/build-cli.sh` builds `topa`, sets `packages/cli/.env.local` to use the local release binary, installs CLI dependencies, and links `tarae` globally with `npm link`.

## Check Rust Changes

```bash
cd packages/watcher
cargo fmt --check
cargo clippy -- -D warnings
cargo test
```

## Check CLI Changes

```bash
node --check packages/cli/bin/index.js
find packages/cli/lib -name '*.js' -exec node --check {} \;
```

Run a local verification smoke test:

```bash
node packages/cli/bin/index.js verify --agent codex --project-root "$PWD" --no-mcp-smoke
```

## Local History Smoke Test

After linking MCP config and restarting the AI app, call these MCP tools from the agent:

1. `start_session`
2. `checkpoint`
3. `report_issue`
4. `end_session`
5. `list_sessions`
6. `read_session`
7. `search_history`

Expected files:

```text
.tarae/topa/session_index.jsonl
.tarae/topa/latest.md
.tarae/topa/sessions/<session-id>.jsonl
.tarae/topa/sessions/<session-id>.md
```

`.tarae/` is local state and is ignored by git.

## Release Checks

Before tagging a release, run:

```bash
cd packages/watcher
cargo fmt --check
cargo clippy -- -D warnings
cargo test
cd ../..
node --check packages/cli/bin/index.js
find packages/cli/lib -name '*.js' -exec node --check {} \;
cd packages/vscode-extension
npm run check
cd ../..
bash -n scripts/install.sh
pwsh -NoProfile -Command '$null = [System.Management.Automation.PSParser]::Tokenize((Get-Content scripts/install.ps1 -Raw), [ref]$null)'
git diff --check
```

Release version files should move together:

```text
packages/watcher/Cargo.toml
packages/watcher/Cargo.lock
packages/cli/package.json
packages/cli/package-lock.json
packages/vscode-extension/package.json
packages/vscode-extension/CHANGELOG.md
```

Release assets are built by `.github/workflows/release.yml` when a `v*` tag is pushed. The VS Code Marketplace publish remains a manual `.github/workflows/vscode-extension.yml` dispatch with `publish=true`.
