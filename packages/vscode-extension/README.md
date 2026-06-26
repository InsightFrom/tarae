# Tarae

[![Install Tarae in VS Code](https://img.shields.io/badge/VS%20Code-Install%20Tarae-007ACC?logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=insightfrom.tarae)

Tarae is a VS Code sidebar, Runtime Webview, and Dashboard Webview for local Tarae coding-session history.

The extension reads project-local history from `.tarae/topa/` and opens session Markdown without writing to project history. Optional LLM reports are written only when you explicitly save a generated report.

## Features

- List sessions from `.tarae/topa/session_index.jsonl`.
- Show an unread count badge for sessions that have not been opened as Markdown.
- Search objectives, summaries, Markdown, and JSONL session events.
- Open session Markdown as a read-only virtual document.
- Open a local-server-free Dashboard Webview for session timelines, optional auto-checkpoint hiding, file changes, attribution tabs, saved searches, collapsible filters, and responsive narrow-screen layouts.
- Show a Runtime Webview for installed `tarae`/`topa` versions, process state, update-needed state, and current workspace daemon health.
- Upgrade the installed local `tarae`/`topa` runtime to the extension version after extension updates.
- Restart only the current workspace's `topa` daemon from the Dashboard or command palette.
- Configure an OpenAI API key in VS Code SecretStorage for session report generation.
- Preview generated session reports and save them under `.tarae/topa/reports/<session-id>/`.

## Requirements

Install Tarae in a workspace and record at least one session so the project contains `.tarae/topa/`.

## Open The Dashboard

Install Tarae from the Visual Studio Marketplace, open a workspace that contains `.tarae/topa/`, then run `Tarae: Open Dashboard` from the Command Palette.

You can also open the Tarae Activity Bar item to see the Runtime Webview and Sessions list.

## Commands

- `Tarae: Open Dashboard`
- `Tarae: List Sessions`
- `Tarae: Search History`
- `Tarae: Open Session Markdown`
- `Tarae: Configure LLM Provider`
- `Tarae: Generate Session Report`
- `Tarae: Clear LLM Credentials`
- `Tarae: Upgrade Local Runtime`
- `Tarae: Restart Topa Daemon`

When the extension activates after a version update, it checks the installed local `~/.tarae/bin/tarae` and `~/.tarae/bin/topa` versions. If they are older than the extension, Tarae runs `tarae upgrade --ref v<extension-version> --project-root <workspace> --no-mcp-smoke`, then requests a project-scoped `topa shutdown --project-root <workspace>` for the current workspace only. Other project daemons are not affected. The next Tarae MCP call starts a fresh project daemon.

The extension does not perform the first-time CLI/runtime install. Run `scripts/install.sh` or `scripts/install.ps1` once before relying on automatic runtime upgrades.

## Settings

- `tarae.llm.provider`: currently `openai`.
- `tarae.llm.model`: model used for generated reports. Default: `gpt-4.1-mini`.
- `tarae.reports.autoSave`: automatically save generated reports after preview generation. Default: `false`.
- `tarae.runtime.autoUpgrade`: automatically upgrade installed local `tarae`/`topa` binaries when the extension is newer. Default: `true`.

API keys are stored only with VS Code SecretStorage. They are never sent to the Webview.

## Search

`Tarae: Search History` reads JSONL events and supports plain text plus filters:

```text
type:checkpoint file:src agent:codex link:codex-main tag:#release after:2026-05-01 before:2026-05-28
```

The Dashboard exposes the same filters as form controls for keyword, file, agent, link, status, tag, and date range.

## Reports

`Tarae: Generate Session Report` and the Dashboard report button use recorded Tarae history as input: session metadata, JSONL events, checkpoint and issue summaries, file change metadata, and rendered session Markdown.

Reports exclude API keys, raw project file contents, and full raw git diffs. If you switch sessions while a report is being generated, Tarae only shows the result on the matching session. Saved reports are written to:

```text
.tarae/topa/reports/<session-id>/<timestamp>.md
```

## Repository

Source and issue tracking live at <https://github.com/InsightFrom/tarae>.
