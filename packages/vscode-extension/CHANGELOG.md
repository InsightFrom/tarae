# Changelog

## 0.1.10 - 2026-06-26

- Add a Tarae Activity Bar Runtime Webview for installed `tarae`/`topa` versions, process state, update-needed state, and current workspace daemon health.
- Strengthen MCP checkpoint and session-end prompt guidance so summaries are written in the user's language.

## 0.1.9 - 2026-06-24

- Automatically align installed local `tarae`/`topa` runtime binaries with the VS Code extension version after extension updates.
- Add `Tarae: Upgrade Local Runtime` and a Dashboard `Upgrade Runtime` button for manual retry.

## 0.1.8 - 2026-06-12

- Track unread sessions in the Tarae sidebar with a Sessions badge.
- Remove the redundant `Tarae: Open Latest Session` command and sidebar item.
- Track extension-update daemon restart state per workspace.
- Debounce history refreshes and tolerate transient `.tarae` file read races.
- Prevent stale Dashboard session/report responses from replacing the selected session.
- Add a Dashboard Timeline checkbox for hiding `auto_checkpoint` events.
- Improve Dashboard loading, error recovery, report save failures, and narrow-screen layout behavior.

## 0.1.7

- Finalize stale active human sessions when later AI activity starts in the same project.
- Add lightweight startup repair for active session state before AI sessions begin.
- Make Dashboard search filters and result sections collapsible.
- Add Dashboard detail tabs, saved/recent filters, and agent attribution summaries.

## 0.1.6

- Add `Tarae: Open Dashboard` with a serverless VS Code Webview for session timelines, filters, file changes, attribution, and report scope.
- Add OpenAI API key configuration through VS Code SecretStorage.
- Add LLM session report preview and explicit save flow under `.tarae/topa/reports/<session-id>/`.
- Restart the current workspace's `topa` daemon after extension updates so upgraded extension behavior applies without affecting other projects.
- Add Marketplace install links, packaging scripts, and GitHub Actions support for manual VS Code Marketplace publishing.
- Add a 128x128 PNG Marketplace icon.
- Add report-related commands and extension settings.

## 0.1.5

- Add `link:` / `link_id:` search filters for multi-agent Tarae history.
- Show MCP link identity in session tooltips and searchable session metadata.

## 0.1.2

- Use archived `topa` release assets for installer downloads.

## 0.1.1

- Add local VSIX packaging metadata and documentation.

## 0.1.0

- Add a read-only Tarae sidebar for local session history.
- Add commands for opening the latest session, listing sessions, searching history, and opening session Markdown.
