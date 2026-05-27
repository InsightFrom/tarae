# Tarae (타래)

[English](README.md) | [한국어](docs/i18n/README.ko.md) | [日本語](docs/i18n/README.ja.md) | [简体中文](docs/i18n/README.zh-CN.md)

Tarae records useful AI coding-session context directly inside your project: intent, checkpoints, errors, and changed files. A small Rust MCP server named `topa` writes local history and exposes it back to AI agents through searchable MCP tools.

Use Tarae when you want the next AI session to understand what happened before by reading structured project-local history instead of relying only on chat memory.

## Quick Start

Prerequisites: `git`, Node.js 18+ with `npm`, and a network connection. The installer downloads the prebuilt `topa` archive from the latest GitHub release.

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/InsightFrom/tarae/main/scripts/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/InsightFrom/tarae/main/scripts/install.ps1 | iex
```

Then link Tarae to an agent in your project:

```bash
~/.tarae/bin/tarae install --agent codex --project-root "$PWD"
```

Windows PowerShell:

```powershell
& "$HOME\.tarae\bin\tarae.ps1" install --agent codex --project-root (Get-Location)
```

Restart the target AI app after linking so it reloads MCP settings.

Supported agents:

```text
codex
cursor
claude
gemini
```

## What It Does

- Provides MCP lifecycle tools for AI agents: `start_session`, `checkpoint`, `report_issue`, `end_session`.
- Writes append-only JSONL event logs under the current project.
- Renders the same session into Markdown for humans and AI agents to read.
- Provides local history tools: `fetch_past_context`, `list_sessions`, `read_session`, `search_history`.
- Watches project file changes and records auto-checkpoints or human intervention events as metadata.

## How Agents Use It

Add this lifecycle to your agent instructions:

```text
1. fetch_past_context()
2. start_session(objective="...")
3. checkpoint(summary="...") after meaningful progress
4. report_issue(error_message="...") when a build, test, or runtime failure happens
5. end_session(summary="...") before the task ends
```

On the next session, the agent can call `fetch_past_context` or `search_history` to recover prior decisions, failures, and changed files.

## Local History

`topa` writes only inside the project root:

```text
.tarae/
└── topa/
    ├── active_session.json
    ├── latest.md
    ├── session_index.jsonl
    └── sessions/
        ├── <session-id>.jsonl
        └── <session-id>.md
```

The JSONL file is the canonical event log using `topa-event-v1`. The Markdown file is a readable projection with YAML frontmatter and a timeline. Tarae records summaries, git refs, file paths/actions/line counts, and short masked error logs.

## Documentation

- [Installation](docs/guide/installation.md)
- [VS Code Extension](docs/guide/vscode-extension.md)
- [Architecture](docs/Architecture.md)
- [Development](DEVELOP.md)
- [Contributing](CONTRIBUTING.md)

## VS Code Extension

The read-only VS Code extension in `packages/vscode-extension` shows local Tarae history from `.tarae/topa/` in a sidebar. It can open the latest session, list sessions, search history, and open session Markdown without writing to project history.

Run it from source with the VS Code Extension Development Host, or package it as a local `.vsix` for installation. See [VS Code Extension](docs/guide/vscode-extension.md).

## Build From Source

Building from source requires Rust stable with `cargo`.

From this repository:

```bash
./scripts/build-cli.sh
```

Then link an agent from your target project:

```bash
tarae install --agent codex --project-root "$PWD"
```

## Commands

```bash
tarae init
tarae link codex --project-root "$PWD"
tarae verify --agent codex --project-root "$PWD"
tarae doctor --project-root "$PWD"
tarae status --project-root "$PWD"
tarae unlink codex
tarae uninstall --all
```

## Verify

```bash
tarae verify --agent codex --project-root "$PWD"
tarae doctor --project-root "$PWD"
```

## Repository Layout

```text
packages/
├── watcher/       # Rust topa binary and MCP server
├── cli/           # Node.js tarae CLI wrapper
├── tarae-plugin/  # Agent-facing skill metadata
└── vscode-extension/ # Read-only VS Code history viewer
docs/
├── guide/installation.md
└── i18n/
```

## Development

```bash
cd packages/watcher
cargo fmt --check
cargo clippy -- -D warnings
cargo test
```

```bash
node packages/cli/bin/index.js verify --project-root "$PWD" --no-mcp-smoke
```

## License

MIT. See [LICENSE.md](LICENSE.md).
