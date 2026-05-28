# Tarae

Tarae is a read-only VS Code sidebar for local Tarae coding-session history.

The extension reads project-local history from `.tarae/topa/` and opens session Markdown without writing to project history.

## Features

- Show the latest Tarae session in the Activity Bar.
- List sessions from `.tarae/topa/session_index.jsonl`.
- Search objectives, summaries, Markdown, and JSONL session events.
- Open session Markdown as a read-only virtual document.

## Requirements

Install Tarae in a workspace and record at least one session so the project contains `.tarae/topa/`.

## Commands

- `Tarae: Open Latest Session`
- `Tarae: List Sessions`
- `Tarae: Search History`
- `Tarae: Open Session Markdown`

## Search

`Tarae: Search History` reads JSONL events and supports plain text plus filters:

```text
type:checkpoint file:src agent:codex tag:#release after:2026-05-01 before:2026-05-28
```

## Repository

Source and issue tracking live at <https://github.com/InsightFrom/tarae>.
