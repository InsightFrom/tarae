# Installation

This guide installs Tarae into a local project and links it to an AI agent through MCP.

Translations: [한국어](../i18n/installation.ko.md) | [日本語](../i18n/installation.ja.md) | [简体中文](../i18n/installation.zh-CN.md)

## Prerequisites

- `git`
- Node.js 18+ with `npm`
- Rust stable with `cargo`
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

## Verify

```bash
tarae verify --agent codex --project-root "$PWD"
tarae doctor --project-root "$PWD"
```

Expected local files after a session:

```text
.tarae/topa/session_index.jsonl
.tarae/topa/latest.md
.tarae/topa/sessions/<session-id>.jsonl
.tarae/topa/sessions/<session-id>.md
```

## Build From Source

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
args = ["serve", "--project-root", "/path/to/project"]

[mcp_servers.tarae.env]
TARAE_PROJECT_ROOT = "/path/to/project"
```

JSON-based clients use the same command and args shape:

```json
{
  "mcpServers": {
    "tarae": {
      "command": "/Users/<user>/.tarae/bin/topa",
      "args": ["serve", "--project-root", "/path/to/project"],
      "env": {
        "TARAE_PROJECT_ROOT": "/path/to/project"
      },
      "disabled": false
    }
  }
}
```

## Uninstall

```bash
tarae unlink codex
tarae uninstall --all
```

Project-local history remains under `.tarae/` unless you delete it yourself after backing up anything you need.

## Troubleshooting

- `Missing required command`: install the prerequisite named in the error.
- `topa binary not found`: run `./scripts/build-cli.sh` from the Tarae repository, then retry `tarae install`.
- The AI app cannot see Tarae tools: restart the app after linking MCP settings.
- Verification fails on project root: pass an absolute path with `--project-root`.
