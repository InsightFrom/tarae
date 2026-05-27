# Contributing

Tarae is a local-first MCP observer for AI coding sessions. Contributions should keep the project easy to install, easy to inspect, and predictable for AI agents that read local history.

## Project Layout

```text
packages/
├── watcher/       # Rust topa binary and MCP server
├── cli/           # Node.js tarae CLI wrapper
└── tarae-plugin/  # Agent-facing skill metadata
```

## Before You Start

1. Read [README.md](README.md) for user-facing behavior.
2. Read [docs/Architecture.md](docs/Architecture.md) for the event model and file layout.
3. Keep `.tarae/` as local working state.

## Development Checks

Run Rust checks before opening a PR:

```bash
cd packages/watcher
cargo fmt --check
cargo clippy -- -D warnings
cargo test
```

For CLI changes:

```bash
node packages/cli/bin/index.js verify --project-root "$PWD" --no-mcp-smoke
```

For installer or documentation changes:

```bash
bash -n scripts/install.sh
git diff --check
```

## Local State

Do not commit project-local Tarae history:

```text
.tarae/
```

Session logs can include summaries, file paths, and masked error logs from local development. Treat them as local working state.

## Commit Style

Use Conventional Commits:

```text
feat(watcher): add local history search
fix(cli): handle missing MCP config
docs: update installation guide
```

## Pull Requests

Include:

- What changed
- Why it changed
- How you tested it
- Any compatibility notes for existing MCP configs

Good PRs keep changes focused. If a change affects the local history schema, include an example event and note whether older session files still read correctly.
