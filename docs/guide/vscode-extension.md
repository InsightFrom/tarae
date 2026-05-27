# VS Code Extension

The Tarae VS Code extension is a local, read-only viewer for project history under `.tarae/topa/`.

## Current Status

The extension lives in `packages/vscode-extension` and is intended for local development first. It is not published to the Visual Studio Marketplace yet.

## What It Reads

The sidebar reads these project-local files:

```text
.tarae/topa/session_index.jsonl
.tarae/topa/latest.md
.tarae/topa/sessions/<session-id>.jsonl
.tarae/topa/sessions/<session-id>.md
```

The extension does not write Tarae history. It opens session Markdown through a read-only virtual document.

## Run From Source

From this repository:

```bash
code --extensionDevelopmentPath="$PWD/packages/vscode-extension" /path/to/project-with-tarae-history
```

Or use the Extension Development Host from VS Code:

1. Open `packages/vscode-extension` in VS Code.
2. Start an Extension Development Host session.
3. In the Extension Development Host window, open a project that contains `.tarae/topa/`.

The Tarae activity bar item shows local sessions for the first workspace folder.

## Commands

- `Tarae: Open Latest Session`
- `Tarae: List Sessions`
- `Tarae: Search History`
- `Tarae: Open Session Markdown`

## Manual Verification

Use a project with Tarae history, then verify:

- The Tarae sidebar lists `latest.md` and session entries.
- `Tarae: Open Latest Session` opens `.tarae/topa/latest.md` as Markdown.
- `Tarae: List Sessions` shows sessions from `session_index.jsonl`.
- `Tarae: Search History` finds text from session objectives, summaries, Markdown, or JSONL.
- Opened session documents are read-only virtual documents.
