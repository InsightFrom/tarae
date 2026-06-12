# VS Code Extension

The Tarae VS Code extension is a local viewer for project history under `.tarae/topa/`. It provides a sidebar plus a serverless VS Code Webview Dashboard for richer inspection.

## Current Status

The extension is published on the Visual Studio Marketplace as `insightfrom.tarae`. Source code lives in `packages/vscode-extension`.

## Install From Marketplace

Install the published extension from the Marketplace page or with the VS Code CLI:

```bash
code --install-extension insightfrom.tarae
```

Then open a workspace that contains `.tarae/topa/` and run `Tarae: Open Dashboard` from the Command Palette. The same Dashboard is also available from the Tarae Activity Bar sidebar.

## What It Reads

The sidebar and Dashboard read these project-local files:

```text
.tarae/topa/session_index.jsonl
.tarae/topa/active_sessions.json
.tarae/topa/latest.md
.tarae/topa/sessions/<session-id>.jsonl
.tarae/topa/sessions/<session-id>.md
```

The extension does not write Tarae session history. It opens session Markdown through a read-only virtual document. If you generate and save an LLM report, the extension writes only that report under:

```text
.tarae/topa/reports/<session-id>/<timestamp>.md
```

The Dashboard does not start a local HTTP server. VS Code hosts the Webview and all file, secret, and API access stays in the extension host.

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
npm run vsix -- --out /tmp/tarae.vsix
code --install-extension /tmp/tarae.vsix
```

On macOS without the `code` command:

```bash
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --install-extension /tmp/tarae.vsix
```

## Marketplace Install Button

The public README links to the Marketplace item:

```text
https://marketplace.visualstudio.com/items?itemName=insightfrom.tarae
```

Use a local VSIX only when testing unpublished changes.

## Maintainer Publishing

VS Code extensions are published with `vsce` to the Visual Studio Marketplace. Tarae's extension manifest already uses:

```text
publisher = insightfrom
name = tarae
item id = insightfrom.tarae
```

Before publishing, the publisher owner must do these one-time setup steps:

1. Create or select an Azure DevOps organization.
2. Create a Visual Studio Marketplace publisher with ID `insightfrom`.
3. Create an Azure DevOps Personal Access Token with `Marketplace: Manage` scope and `All accessible organizations`.
4. Verify the publisher locally:

```bash
cd packages/vscode-extension
npx --yes @vscode/vsce login insightfrom
```

To publish from a local machine:

```bash
cd packages/vscode-extension
npm run check
npm run vsix
VSCE_PAT="<azure-devops-pat>" npm run publish
```

To publish from GitHub Actions:

1. Add repository secret `VSCE_PAT` with the Azure DevOps PAT.
2. Optionally create a protected environment named `vscode-marketplace`.
3. Run the `VS Code Extension` workflow manually.
4. Set `publish` to `true`.

The workflow always packages a VSIX artifact. It publishes to Marketplace only when `publish` is enabled.

Marketplace notes:

- Increment `packages/vscode-extension/package.json` `version` before every publish.
- Keep `README.md`, `CHANGELOG.md`, and `LICENSE.md` in the extension package.
- README and CHANGELOG images must use `https` URLs.
- The Marketplace `icon` is `resources/tarae.png`, converted from the Activity Bar SVG at 128x128 pixels.
- The Activity Bar still uses `resources/tarae.svg`; keep the Marketplace icon as PNG because `vsce` does not allow SVG package icons.

References:

- [VS Code: Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [VS Code: Extension Manifest](https://code.visualstudio.com/api/references/extension-manifest)

## Commands

- `Tarae: Open Dashboard`
- `Tarae: List Sessions`
- `Tarae: Search History`
- `Tarae: Open Session Markdown`
- `Tarae: Configure LLM Provider`
- `Tarae: Generate Session Report`
- `Tarae: Clear LLM Credentials`
- `Tarae: Restart Topa Daemon`

After an extension version update, Tarae automatically requests `topa shutdown --project-root <workspace>` for the current workspace only. Restart state is tracked per workspace, so this does not touch or suppress restart handling for other projects. The next Tarae MCP tool call starts a fresh project daemon.

Use `Tarae: Restart Topa Daemon` when you want to restart the current workspace daemon manually.

## Dashboard

`Tarae: Open Dashboard` opens a Webview with:

- Session list with status, updated time, event count, agent, link id, and tags.
- Unread session count badge for sessions not yet opened as Markdown.
- Collapsible filters for keyword, file, agent, link, status, tag, and date range, plus saved and recent searches.
- Session detail tabs for overview, timeline events, file changes, agent attribution, and report generation.
- Timeline checkbox for hiding noisy `auto_checkpoint` events during review.
- Report scope preview showing what will and will not be sent to the LLM.
- Loading and stale-response handling so slow session/report responses do not overwrite the wrong selected session.
- A `Restart Topa` button that stops only the current workspace daemon.

The Webview receives only sanitized dashboard data from the extension host. It cannot read the workspace filesystem or access API keys directly.

## LLM Reports

`Tarae: Configure LLM Provider` stores an OpenAI API key in VS Code SecretStorage. The key is never written to `.tarae/`, settings JSON, or the Webview.

Settings:

```text
tarae.llm.provider = openai
tarae.llm.model = gpt-4.1-mini
tarae.reports.autoSave = false
```

Report generation uses recorded Tarae history as input: session metadata, JSONL event timeline, checkpoint and issue summaries, file change metadata, and rendered session Markdown. It excludes API keys, raw project file contents, and full raw git diffs.

When `tarae.reports.autoSave` is `false`, generated reports are previewed first. Report responses are matched to the selected session before display. Use `Save Report` to write them under `.tarae/topa/reports/<session-id>/`.

## Search Syntax

`Tarae: Search History` searches session JSONL events, not only rendered Markdown. Plain words must all match somewhere in the event, session metadata, file paths, git metadata, agent/link identity, summaries, errors, or log tails.

Supported filters:

```text
type:checkpoint
file:packages/watcher
agent:codex
link:codex-main
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

- The Tarae sidebar lists session entries and shows an unread count badge for sessions not yet opened as Markdown.
- `Tarae: Open Dashboard` opens the Webview without starting a local server.
- The Dashboard filters by keyword, file, agent, link, status, tag, and date range.
- Selecting a session shows timeline events, file changes, and report scope.
- The Timeline tab can hide and restore `auto_checkpoint` events with its checkbox.
- Switching sessions while details or reports are loading does not replace the newly selected session with an older response.
- `Tarae: List Sessions` shows sessions from `session_index.jsonl`.
- `Tarae: Search History` finds event-level JSONL matches by text and filters.
- Opened session documents are read-only virtual documents.
- `Tarae: Configure LLM Provider` stores the key through SecretStorage.
- `Tarae: Clear LLM Credentials` removes the stored key.
- Generating a report without credentials prompts for LLM configuration.
- Generating a report with credentials previews Markdown before saving.
- The Dashboard remains usable at narrow widths without topbar buttons overlapping.
- `Save Report` writes `.tarae/topa/reports/<session-id>/<timestamp>.md`.
- `Tarae: Restart Topa Daemon` stops only the current workspace daemon.
