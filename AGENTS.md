# Tarae Agent Directives

## Tarae MCP Lifecycle

Use the Tarae MCP tools for coding tasks when available:

1. `fetch_past_context`
2. `start_session(objective=...)`
3. `checkpoint(summary=...)` after meaningful milestones
4. `report_issue(error_message=...)` on build/test/runtime failure
5. `end_session(summary=...)`

`checkpoint.summary` and `end_session.summary` MUST be written in the user's language from the conversation. If the user is writing Korean, write the summaries in Korean.

Tarae writes local project history under `.tarae/topa/`.

## Project Structure

```text
packages/
├─ watcher/       # Rust topa CLI and MCP server
├─ cli/           # Node.js tarae CLI wrapper
└─ tarae-plugin/  # Agent-facing skill metadata
docs/
├─ Architecture.md
├─ guide/
└─ i18n/
```

## Build And Test

| Component | Build | Test |
|-----------|-------|------|
| watcher | `cd packages/watcher && cargo build --release` | `cargo test` |
| cli | `./scripts/build-cli.sh` | `node packages/cli/bin/index.js verify --project-root "$PWD" --no-mcp-smoke` |

## Conventions

- Keep user-facing Korean text when editing Korean documentation or prompts.
- Rust must pass `cargo fmt`, `cargo clippy`, and `cargo test`.
- TypeScript/JavaScript CLI changes should stay simple and Node 18-compatible.
- Do not commit `.tarae/` local history.
