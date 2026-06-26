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
.tarae/topa/active_sessions.json
.tarae/topa/sessions/<session-id>.jsonl
.tarae/topa/sessions/<session-id>.md
```

Use Tarae as a bidirectional project memory layer: write progress with lifecycle tools, then search prior work with history tools before starting or resuming a task.

## Lifecycle

1. Call `fetch_past_context` before starting substantial work. Include `project_root` when the MCP client does not expose roots/list.
2. Call `start_session` with a clear objective. Include `project_root` when the MCP client does not expose roots/list.
3. Call `checkpoint` after meaningful milestones.
4. Call `report_issue` when a build, test, or runtime failure matters.
5. Call `end_session` when the task is complete.

Write `checkpoint.summary` and `end_session.summary` in the user's language from the conversation. This is mandatory. If the user is writing Korean, write those summaries in Korean.

## History Tools

- `list_sessions(project_root, limit, status)`: show recent local sessions.
- `read_session(project_root, session_id, format)`: read Markdown or JSONL for a session.
- `search_history(project_root, query, file_path, event_type, agent_name, link_id, session_id, status, tag, after, before, limit)`: search local objective, summaries, errors, logs, file paths, agent/link identity, tags, status, and time ranges.
- `fetch_past_context(project_root, session_id)`: read one session or recent local context.

Use `search_history` when you need targeted context for a file, prior failure, agent role, MCP link id, tag, status, or date range.

## Privacy

Do not include raw source code or secrets in summaries. Tarae records metadata, file paths, line counts, git refs, and short masked error logs. `.tarae/` is local state and should not be committed.
