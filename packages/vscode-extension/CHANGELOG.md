# Changelog

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
