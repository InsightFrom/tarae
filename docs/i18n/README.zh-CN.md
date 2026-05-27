# Tarae

[English](../../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

Tarae 会把 AI 编码会话的意图、检查点、错误和变更文件记录在项目中。小型 Rust MCP 服务器 `topa` 负责写入本地历史，并让 AI Agent 可以再次检索这些记录。

当下一个 AI 会话需要快速理解之前的决定、失败和变更文件时，可以使用 Tarae。

## 快速开始

需要的工具: `git`, Node.js 18+ 和 `npm`, 以及可访问 GitHub Releases 中预构建 `topa` 归档文件的网络。

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/InsightFrom/tarae/main/scripts/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/InsightFrom/tarae/main/scripts/install.ps1 | iex
```

在项目中连接 Agent:

```bash
~/.tarae/bin/tarae install --agent codex --project-root "$PWD"
```

Windows PowerShell:

```powershell
& "$HOME\.tarae\bin\tarae.ps1" install --agent codex --project-root (Get-Location)
```

连接后重启目标 AI 应用，让它重新加载 MCP 设置。

支持的 Agent:

```text
codex
cursor
claude
gemini
```

## 功能

- MCP 生命周期工具: `start_session`, `checkpoint`, `report_issue`, `end_session`
- 在项目内写入 append-only JSONL 事件日志
- 为人类和 AI Agent 渲染 Markdown 会话记录
- 本地历史工具: `fetch_past_context`, `list_sessions`, `read_session`, `search_history`
- 以 metadata 方式跟踪文件变更，并记录自动检查点和人工介入事件

## Agent 使用方式

在 Agent 指令中加入以下 lifecycle:

```text
1. fetch_past_context()
2. start_session(objective="...")
3. checkpoint(summary="...")
4. report_issue(error_message="...")
5. end_session(summary="...")
```

下一个会话可以通过 `fetch_past_context` 或 `search_history` 找回之前的工作记录。

## 本地历史

```text
.tarae/
└── topa/
    ├── active_session.json
    ├── latest.md
    ├── session_index.jsonl
    └── sessions/
        ├── <session-id>.jsonl
        └── <session-id>.md
```

JSONL 是标准的 `topa-event-v1` 事件日志。Markdown 是带有 YAML frontmatter 和 timeline 的可读投影。

## 了解更多

- [Installation](installation.zh-CN.md)
- [Architecture](../Architecture.md)
- [Development](../../DEVELOP.md)
- [Contributing](../../CONTRIBUTING.md)
