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

`/path/to/project-with-tarae-history` means the workspace you want to inspect, not the extension package. Use a project that contains `.tarae/topa/`. If the `code` command is not in your `PATH` on macOS, use the bundled CLI directly:

```bash
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --extensionDevelopmentPath="$PWD/packages/vscode-extension" \
  /path/to/project-with-tarae-history
```

Or use the Extension Development Host from VS Code:

1. Open `packages/vscode-extension` in VS Code.
2. Start an Extension Development Host session.
3. In the Extension Development Host window, open a project that contains `.tarae/topa/`.

The Tarae activity bar item shows local sessions for the first workspace folder.

## Install A Local VSIX

Package the extension and install it into the local VS Code profile:

```bash
cd packages/vscode-extension
npx --yes @vscode/vsce package --no-dependencies --out /tmp/tarae.vsix
code --install-extension /tmp/tarae.vsix
```

On macOS without the `code` command:

```bash
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --install-extension /tmp/tarae.vsix
```

## Commands

- `Tarae: Open Latest Session`
- `Tarae: List Sessions`
- `Tarae: Search History`
- `Tarae: Open Session Markdown`

## Search Syntax

`Tarae: Search History` searches session JSONL events, not only rendered Markdown. Plain words must all match somewhere in the event, session metadata, file paths, git metadata, summaries, errors, or log tails.

Supported filters:

```text
type:checkpoint
file:packages/watcher
agent:codex
tag:#release
session:<session-id>
status:completed
after:2026-05-01
before:2026-05-28
```

Filters can be combined:

```text
type:auto_checkpoint file:packages/cli after:2026-05-27
```

## Manual Verification

Use a project with Tarae history, then verify:

- The Tarae sidebar lists `latest.md` and session entries.
- `Tarae: Open Latest Session` opens `.tarae/topa/latest.md` as Markdown.
- `Tarae: List Sessions` shows sessions from `session_index.jsonl`.
- `Tarae: Search History` finds event-level JSONL matches by text and filters.
- Opened session documents are read-only virtual documents.
