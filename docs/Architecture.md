# Architecture

Tarae is a local MCP observer for AI coding sessions. The main runtime is `topa`, a Rust binary that runs as an MCP stdio server, records session events, watches local file changes, and stores history inside the project.

The design goal is simple: keep the useful context from AI-assisted development close to the codebase, in formats that both people and AI agents can read.

## System Overview

```mermaid
flowchart TB
    User["Developer"] -->|"asks agent to work"| Agent["AI Agent"]
    Agent <-->|"MCP stdio"| Topa["topa (Rust MCP server)"]
    Files["Project filesystem"] -->|"file events"| Topa
    Git["Git metadata"] -->|"branch and commit"| Topa
    Topa --> History[".tarae/topa"]

    subgraph HistoryFiles["Local History Files"]
        Active["active_session.json"]
        Jsonl["sessions/<session-id>.jsonl"]
        Md["sessions/<session-id>.md"]
        Index["session_index.jsonl"]
        Latest["latest.md"]
    end

    History --> Active
    History --> Jsonl
    History --> Md
    History --> Index
    History --> Latest
```

## Components

- `packages/watcher`: Rust crate that builds `topa`. It hosts the MCP server, watches file changes, collects git metadata, masks sensitive text, and writes local history.
- `packages/cli`: Node.js CLI for install, link, verify, doctor, status, unlink, and uninstall workflows.
- `packages/tarae-plugin`: agent-facing skill metadata that describes the Tarae lifecycle.
- `docs`: public installation, architecture, and contributor documentation.

## Runtime Flow

1. The user links Tarae to an AI agent with `tarae install --agent <agent> --project-root <path>`.
2. The CLI writes the target agent MCP configuration so it can launch `topa serve --project-root <path>`.
3. The AI agent calls Tarae lifecycle tools while it works.
4. `topa` appends canonical JSONL events under `.tarae/topa/sessions/`.
5. `topa` regenerates a Markdown projection for the same session and updates `latest.md`.
6. Search tools scan `session_index.jsonl` and session JSONL files when an agent asks for prior context.

## File Layout

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

- `sessions/<session-id>.jsonl` is the append-only source of truth.
- `sessions/<session-id>.md` is a readable projection with YAML frontmatter and a timeline.
- `latest.md` points people and agents to the most recent rendered session.
- `session_index.jsonl` is a compact search and listing index.
- `active_session.json` tracks the currently open lifecycle session.

## Event Model

`topa-event-v1` is the canonical local event schema:

```json
{
  "schema_version": "topa-event-v1",
  "event_id": "uuid-v4",
  "event_type": "checkpoint",
  "timestamp": "2026-05-27T00:00:00Z",
  "session_id": "uuid-v4",
  "actor": { "type": "ai_agent", "agent_name": "codex" },
  "payload": {
    "summary": "Implemented local history",
    "git_ref": { "branch": "oss", "commit_hash": "abc123" },
    "file_changes": [{ "path": "src/main.rs", "action": "modified", "lines_added": 12 }]
  }
}
```

The JSONL file is append-only. Markdown is regenerated after each event from the JSONL source so it remains easy to read and safe to overwrite.

## Markdown Projection

Markdown session files are optimized for quick reading. They include:

- YAML frontmatter: `session_id`, `objective`, `agent_name`, `status`, timestamps, tags, and project root.
- Timeline entries for lifecycle events.
- Checkpoint and issue summaries.
- Git branch and commit metadata when available.
- Changed file paths, actions, and line counts.
- Short masked log tails for reported issues.

Raw source files, raw diffs, and secrets are outside the Markdown projection.

## MCP Tools

Lifecycle:

- `start_session`
- `checkpoint`
- `report_issue`
- `end_session`

History:

- `fetch_past_context`
- `list_sessions`
- `read_session`
- `search_history`

Search is intentionally simple in v1: it scans `session_index.jsonl` and session JSONL files for objective, summary, error text, log tail, file path, and event type matches.

## Privacy And Safety Boundary

Tarae records metadata and user-provided summaries. Error text and log tails pass through the local PII filter before being persisted.

Recommended project hygiene:

- Keep `.tarae/` ignored by git unless you intentionally want to publish selected session notes.
- Avoid passing raw secrets, credentials, or proprietary source snippets in MCP tool arguments.
- Treat session history as development context that may contain project paths, summaries, and masked logs.

## Verification Surface

The CLI verification flow checks:

- `topa` binary availability.
- Project root resolution.
- Local history writeability.
- MCP configuration for the selected agent.
- Optional MCP lifecycle smoke test.

## Extension Points

Tarae is intentionally small in v1. Useful extension points are:

- Additional MCP clients in `packages/cli/lib/link.js`.
- Richer search over JSONL history.
- Better Markdown projections for team handoff notes.
- Optional packaging channels for platform-specific release binaries.
