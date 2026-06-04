# Installation

This guide installs Tarae into a local project and links it to an AI agent through MCP.

Translations: [한국어](../i18n/installation.ko.md) | [日本語](../i18n/installation.ja.md) | [简体中文](../i18n/installation.zh-CN.md)

## Prerequisites

- `git`
- Node.js 18+ with `npm`
- Network access to GitHub releases for the prebuilt `topa` archive
- An AI app or agent that can launch local MCP servers

## Quick Start

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/InsightFrom/tarae/main/scripts/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/InsightFrom/tarae/main/scripts/install.ps1 | iex
```

Then link Tarae to an agent in your project:

```bash
~/.tarae/bin/tarae install --agent codex --project-root "$PWD"
```

Windows PowerShell:

```powershell
& "$HOME\.tarae\bin\tarae.ps1" install --agent codex --project-root (Get-Location)
```

Restart the target AI application after linking MCP config.

## Release Integrity

Release archives are downloaded from GitHub Releases. Each `topa-*.tar.gz` release asset has a matching `.sha256` checksum, and release builds publish GitHub artifact attestations.

Example verification for macOS Apple Silicon:

```bash
curl -LO https://github.com/InsightFrom/tarae/releases/latest/download/topa-darwin-arm64.tar.gz
curl -LO https://github.com/InsightFrom/tarae/releases/latest/download/topa-darwin-arm64.tar.gz.sha256
shasum -a 256 -c topa-darwin-arm64.tar.gz.sha256
gh attestation verify topa-darwin-arm64.tar.gz -R InsightFrom/tarae
```

## Add Tarae To PATH

The installer places the CLI under `~/.tarae/bin`. Use the full path shown above, or add the directory to your shell profile.

macOS / Linux:

```bash
export PATH="$HOME/.tarae/bin:$PATH"
```

Windows PowerShell:

```powershell
$env:Path = "$HOME\.tarae\bin;$env:Path"
```

## Upgrade

When upgrading an existing install, prefer the `~/.tarae/bin/tarae` shim so an older global npm install does not take precedence:

```bash
command -v tarae
tarae --version
~/.tarae/bin/tarae --version
~/.tarae/bin/topa --version
~/.tarae/bin/tarae verify --project-root "$PWD" --no-mcp-smoke
```

Upgrade to a released version:

```bash
~/.tarae/bin/tarae upgrade --ref v0.1.6 --project-root "$PWD"
```

Or rerun the installer for users who installed before the `upgrade` command existed:

```bash
curl -fsSL https://raw.githubusercontent.com/InsightFrom/tarae/main/scripts/install.sh | TARAE_REF=v0.1.6 bash
```

For unreleased branch testing, build `topa` from source instead of downloading the latest release asset:

```bash
~/.tarae/bin/tarae upgrade --ref main --build-from-source --project-root "$PWD"
```

Restart the target AI app after upgrading so old MCP stdio bridge processes are replaced.

## Link A Different Agent

```bash
tarae install --agent codex --project-root "$PWD"
```

Supported agent names:

```text
codex
cursor
claude
gemini
```

The command prepares `topa`, writes MCP settings for the selected agent, and runs local verification.
It also prints an `MCP files touched` summary showing which config file was read, backed up, or written.
By default, the MCP config is project-root agnostic. Tarae resolves the project at tool-call time from MCP `roots/list`, or from the `project_root` argument passed to lifecycle and history tools. Use `--fixed-project-root` only for MCP clients that cannot provide either.
Each linked MCP config also gets a stable `TARAE_LINK_ID` and `TARAE_AGENT_NAME`, so multiple agents can keep separate active sessions in the same project. Pass `--link-id <id>` when an orchestrator needs a predictable identity.

For an unsupported MCP-capable agent, pass its config path. Tarae writes a JSON MCP config by default, or a Codex-style TOML config when the path ends in `.toml`.

```bash
tarae link my-agent --config-path ~/.my-agent/mcp.json --project-root "$PWD"
tarae link codex --project-root "$PWD" --link-id codex-backend
tarae verify --agent my-agent --config-path ~/.my-agent/mcp.json --project-root "$PWD"
```

## Verify

```bash
tarae verify --agent codex --project-root "$PWD"
tarae doctor --project-root "$PWD"
```

Expected local files after a session:

```text
.tarae/topa/session_index.jsonl
.tarae/topa/latest.md
.tarae/topa/active_sessions.json
.tarae/topa/runtime/server.json
.tarae/topa/sessions/<session-id>.jsonl
.tarae/topa/sessions/<session-id>.md
```

## Build From Source

Building from source requires Rust stable with `cargo`.

From the Tarae repository:

```bash
./scripts/build-cli.sh
```

From a target project:

```bash
tarae install --agent codex --project-root "$PWD"
```

## MCP Configuration Shape

Codex example:

```toml
[mcp_servers.tarae]
command = "/Users/<user>/.tarae/bin/topa"
args = ["serve"]

[mcp_servers.tarae.env]
TARAE_AGENT_NAME = "codex"
TARAE_LINK_ID = "codex-backend"
```

JSON-based clients use the same command and args shape:

```json
{
  "mcpServers": {
    "tarae": {
      "command": "/Users/<user>/.tarae/bin/topa",
      "args": ["serve"],
      "env": {
        "TARAE_AGENT_NAME": "gemini",
        "TARAE_LINK_ID": "gemini-qa"
      },
      "disabled": false
    }
  }
}
```

For clients that cannot expose MCP roots and cannot pass `project_root` to tool calls, opt into the older fixed-root shape:

```bash
tarae link codex --project-root "$PWD" --fixed-project-root
```

## Stop Topa

`topa serve` remains the MCP stdio entrypoint, but it is now a lightweight bridge. The first lifecycle tool call starts or reuses one project-scoped `topa daemon`, which owns file watching, active session state, and history writes. Active sessions are separated by MCP link id, so orchestrated agents can work in parallel without sharing one lifecycle session.

To stop recording a session, call `end_session`. To stop the project daemon, run:

```bash
topa shutdown --project-root "$PWD"
```

To prevent future launches, unlink Tarae and restart the AI app:

```bash
tarae unlink codex
```

## Uninstall

```bash
tarae unlink codex
tarae uninstall --all
```

Project-local history remains under `.tarae/` unless you delete it yourself after backing up anything you need.

## Troubleshooting

- `Missing required command`: install the prerequisite named in the error.
- `Failed to download topa release archive`: check network access to `https://github.com/InsightFrom/tarae/releases/latest/download/`.
- macOS says the binary cannot be checked: install with the script instead of a browser download, or remove the quarantine attribute from the installed binary with `xattr -d com.apple.quarantine ~/.tarae/bin/topa`.
- `topa binary not found` after building from source: run `./scripts/build-cli.sh` from the Tarae repository, then retry `tarae install`.
- The AI app cannot see Tarae tools: restart the app after linking MCP settings.
- Verification fails on project root: pass an absolute path with `--project-root`.
