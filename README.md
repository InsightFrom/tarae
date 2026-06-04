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
The CLI prints an `MCP files touched` summary showing which config file was read, backed up, or written.
By default, the MCP config is project-root agnostic. Tarae resolves the project at tool-call time from MCP `roots/list`, or from the `project_root` argument passed to lifecycle tools. Use `--fixed-project-root` only for clients that cannot provide either.
Linked MCP configs include `TARAE_AGENT_NAME` and `TARAE_LINK_ID` so orchestrated agents can keep separate active sessions in one project. Use `--link-id <id>` when you need a stable role identity, for example `codex-backend` or `gemini-qa`.

Supported agents:

```text
codex
cursor
claude
gemini
```

For an unsupported MCP-capable agent, provide its config path:

```bash
~/.tarae/bin/tarae link my-agent --config-path ~/.my-agent/mcp.json --project-root "$PWD"
~/.tarae/bin/tarae link codex --project-root "$PWD" --link-id codex-backend
~/.tarae/bin/tarae verify --agent my-agent --config-path ~/.my-agent/mcp.json --project-root "$PWD"
```

## Upgrade

If file change entries show `lines_added: 0` and `lines_removed: 0` for every watched file, first check which Tarae executable is actually being used:

```bash
command -v tarae
tarae --version
~/.tarae/bin/tarae --version
~/.tarae/bin/topa --version
~/.tarae/bin/tarae verify --project-root "$PWD" --no-mcp-smoke
```

Upgrade the project-local install and restart the AI app so it launches fresh MCP bridge processes:

```bash
~/.tarae/bin/tarae upgrade --ref v0.1.6 --project-root "$PWD"
```

If your installed CLI does not have `upgrade` yet, rerun the installer for the target release:

```bash
curl -fsSL https://raw.githubusercontent.com/InsightFrom/tarae/main/scripts/install.sh | TARAE_REF=v0.1.6 bash
```

For unreleased branch testing, build `topa` from the selected source ref:

```bash
~/.tarae/bin/tarae upgrade --ref main --build-from-source --project-root "$PWD"
```

## What It Does

- Provides MCP lifecycle tools for AI agents: `start_session`, `checkpoint`, `report_issue`, `end_session`.
- Writes append-only JSONL event logs under the current project.
- Renders the same session into Markdown for humans and AI agents to read.
- Provides local history tools: `fetch_past_context`, `list_sessions`, `read_session`, `search_history`.
- Watches project file changes and records auto-checkpoints or human intervention events as metadata.
- Tracks concurrent AI agents by MCP `link_id`, so Codex, Claude, Gemini, and custom orchestrated workers can keep separate active sessions in one project.

## How Agents Use It

Add this lifecycle to your agent instructions:

```text
1. fetch_past_context(project_root="...") when roots/list is unavailable
2. start_session(objective="...", project_root="...") when roots/list is unavailable
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
    ├── active_sessions.json
    ├── latest.md
    ├── runtime/
    │   └── server.json
    ├── session_index.jsonl
    └── sessions/
        ├── <session-id>.jsonl
        └── <session-id>.md
```

The JSONL file is the canonical event log using `topa-event-v1`. The Markdown file is a readable projection with YAML frontmatter and a timeline. Tarae records summaries, git refs, file paths/actions/line counts, agent/link identity, watcher attribution, and short masked error logs.

## Documentation

- [Installation](docs/guide/installation.md)
- [VS Code Extension](docs/guide/vscode-extension.md)
- [Architecture](docs/Architecture.md)
- [Development](DEVELOP.md)
- [Contributing](CONTRIBUTING.md)

## VS Code Extension

[![Install Tarae in VS Code](https://img.shields.io/badge/VS%20Code-Install%20Tarae-007ACC?logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=insightfrom.tarae)

The VS Code extension in `packages/vscode-extension` shows local Tarae history from `.tarae/topa/` in a sidebar and Dashboard Webview. It can open the latest session, list sessions, search event history, inspect session timelines, and generate optional LLM session reports.

By default the extension only reads project history. If you configure an OpenAI API key, Tarae stores it in VS Code SecretStorage and uses it from the extension host; the Webview never receives the key. Reports are saved only when you explicitly choose to save them, under `.tarae/topa/reports/<session-id>/`.

After a VS Code extension version update, Tarae automatically restarts only the current workspace's project daemon by requesting `topa shutdown --project-root <workspace>`. Other project daemons are not affected.

The Marketplace install link becomes active after the first `insightfrom.tarae` publish.

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
tarae link my-agent --config-path ~/.my-agent/mcp.json --project-root "$PWD"
tarae link codex --project-root "$PWD" --fixed-project-root
tarae verify --agent codex --project-root "$PWD"
tarae upgrade --ref v0.1.6 --project-root "$PWD"
tarae doctor --project-root "$PWD"
tarae status --project-root "$PWD"
tarae unlink codex
tarae unlink my-agent --config-path ~/.my-agent/mcp.json
tarae uninstall --all
```

## Stopping Topa

`topa serve` stays compatible with MCP stdio clients, but it now acts as a lightweight bridge. The first tool call starts or reuses one project-scoped `topa daemon`, and that daemon owns file watching, link-scoped active sessions, and history writes for the project.

To stop recording a session, call `end_session`. To stop the local project daemon, run `topa shutdown --project-root "$PWD"` or unlink Tarae and restart the AI app. `tarae status --project-root "$PWD"` separates the single state daemon from temporary stdio bridge processes.

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
└── vscode-extension/ # VS Code history viewer and optional report UI
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
