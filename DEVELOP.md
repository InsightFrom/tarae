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
bash -n scripts/install.sh
git diff --check
```

Release assets are built by `.github/workflows/release.yml` when a `v*` tag is pushed.
