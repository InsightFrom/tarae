---
name: tarae
description: |
  Local-first Tarae MCP lifecycle guide. Use when starting, tracking, searching, or closing AI coding work with topa. Tarae records project-local JSONL and Markdown history under .tarae/topa.
---

# Tarae Local History Skill

Tarae is a non-invasive local observer for AI coding sessions. The `topa` MCP server records lifecycle events into project-local files:

```text
.tarae/topa/session_index.jsonl
.tarae/topa/latest.md
.tarae/topa/sessions/<session-id>.jsonl
.tarae/topa/sessions/<session-id>.md
```

## Lifecycle

1. Call `fetch_past_context` before starting substantial work. Include `project_root` when the MCP client does not expose roots/list.
2. Call `start_session` with a clear objective. Include `project_root` when the MCP client does not expose roots/list.
3. Call `checkpoint` after meaningful milestones.
4. Call `report_issue` when a build, test, or runtime failure matters.
5. Call `end_session` when the task is complete.

## History Tools

- `list_sessions(project_root, limit, status)`: show recent local sessions.
- `read_session(project_root, session_id, format)`: read Markdown or JSONL for a session.
- `search_history(project_root, query, file_path, event_type, limit)`: search local objective, summaries, errors, logs, and file paths.
- `fetch_past_context(project_root, session_id)`: read one session or recent local context.

## Privacy

Do not include raw source code or secrets in summaries. Tarae records metadata, file paths, line counts, git refs, and short masked error logs. `.tarae/` is local state and should not be committed.
