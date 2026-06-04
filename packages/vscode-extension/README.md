# Tarae

[![Install Tarae in VS Code](https://img.shields.io/badge/VS%20Code-Install%20Tarae-007ACC?logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=insightfrom.tarae)

Tarae is a VS Code sidebar and Dashboard Webview for local Tarae coding-session history.

The extension reads project-local history from `.tarae/topa/` and opens session Markdown without writing to project history. Optional LLM reports are written only when you explicitly save a generated report.

## Features

- Show the latest Tarae session in the Activity Bar.
- List sessions from `.tarae/topa/session_index.jsonl`.
- Search objectives, summaries, Markdown, and JSONL session events.
- Open session Markdown as a read-only virtual document.
- Open a local-server-free Dashboard Webview for session timelines, file changes, attribution, and collapsible filters.
- Restart only the current workspace's `topa` daemon from the Dashboard or command palette.
- Configure an OpenAI API key in VS Code SecretStorage for session report generation.
- Preview generated session reports and save them under `.tarae/topa/reports/<session-id>/`.

## Requirements

Install Tarae in a workspace and record at least one session so the project contains `.tarae/topa/`.

## Open The Dashboard

Install Tarae from the Visual Studio Marketplace, open a workspace that contains `.tarae/topa/`, then run `Tarae: Open Dashboard` from the Command Palette.

You can also open the Tarae Activity Bar item and use the Dashboard entry from the sidebar.

## Commands

- `Tarae: Open Dashboard`
- `Tarae: Open Latest Session`
- `Tarae: List Sessions`
- `Tarae: Search History`
- `Tarae: Open Session Markdown`
- `Tarae: Configure LLM Provider`
- `Tarae: Generate Session Report`
- `Tarae: Clear LLM Credentials`
- `Tarae: Restart Topa Daemon`

When the extension activates after a version update, it automatically runs a project-scoped `topa shutdown --project-root <workspace>` for the current workspace only. Other projects are not affected. The next Tarae MCP call starts a fresh project daemon.

## Settings

- `tarae.llm.provider`: currently `openai`.
- `tarae.llm.model`: model used for generated reports. Default: `gpt-4.1-mini`.
- `tarae.reports.autoSave`: automatically save generated reports after preview generation. Default: `false`.

API keys are stored only with VS Code SecretStorage. They are never sent to the Webview.

## Search

`Tarae: Search History` reads JSONL events and supports plain text plus filters:

```text
type:checkpoint file:src agent:codex link:codex-main tag:#release after:2026-05-01 before:2026-05-28
```

The Dashboard exposes the same filters as form controls for keyword, file, agent, link, status, tag, and date range.

## Reports

`Tarae: Generate Session Report` and the Dashboard report button use recorded Tarae history as input: session metadata, JSONL events, checkpoint and issue summaries, file change metadata, and rendered session Markdown.

Reports exclude API keys, raw project file contents, and full raw git diffs. Saved reports are written to:

```text
.tarae/topa/reports/<session-id>/<timestamp>.md
```

## Repository

Source and issue tracking live at <https://github.com/InsightFrom/tarae>.
