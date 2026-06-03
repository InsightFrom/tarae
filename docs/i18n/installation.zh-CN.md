# 安装

本指南会把 Tarae 安装到本地项目中，并通过 MCP 连接到 AI Agent。

## 需要的工具

- `git`
- Node.js 18+ 和 `npm`
- 用于下载预构建 `topa` 归档文件的 GitHub Releases 访问权限
- 可以启动本地 MCP 服务器的 AI 应用或 Agent

## 快速开始

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

## 添加到 PATH

安装后的 CLI 位于 `~/.tarae/bin`。可以使用上面的完整路径，也可以加入 shell profile。

```bash
export PATH="$HOME/.tarae/bin:$PATH"
```

Windows PowerShell:

```powershell
$env:Path = "$HOME\.tarae\bin;$env:Path"
```

支持的 Agent:

```text
codex
cursor
claude
gemini
```

CLI 会通过 `MCP files touched` 摘要显示读取、备份和写入了哪些配置文件。
默认 MCP 配置不会固定到某个项目。Tarae 会通过 MCP `roots/list` 或 lifecycle/history 工具的 `project_root` 参数确定项目。两者都不可用的 MCP 客户端可以使用 `--fixed-project-root`。
每个 MCP 配置还会记录 `TARAE_AGENT_NAME` 和 `TARAE_LINK_ID`。当多个 AI Agent 在同一个项目中并行运行时，active session 会按 link id 分离。编排工具可以通过 `--link-id <id>` 指定固定身份。

对于不在支持列表中的 MCP 兼容 Agent，可以直接指定配置文件路径:

```bash
tarae link my-agent --config-path ~/.my-agent/mcp.json --project-root "$PWD"
tarae link codex --project-root "$PWD" --link-id codex-backend
tarae verify --agent my-agent --config-path ~/.my-agent/mcp.json --project-root "$PWD"
```

## 停止 Topa

`topa serve` 现在是保持 MCP stdio 兼容的轻量桥接进程。第一次 lifecycle 工具调用会启动或复用项目级 `topa daemon`，并由这个单一 daemon 负责文件监听、活动会话状态和历史写入。项目 daemon 可用 `topa shutdown --project-root "$PWD"` 停止。

记录会话请调用 `end_session`。如果要阻止以后继续启动，请 unlink Tarae 后重启 AI 应用:

```bash
tarae unlink codex
```

## 验证

```bash
tarae verify --agent codex --project-root "$PWD"
tarae doctor --project-root "$PWD"
```

会话后会生成的文件:

```text
.tarae/topa/session_index.jsonl
.tarae/topa/latest.md
.tarae/topa/active_sessions.json
.tarae/topa/runtime/server.json
.tarae/topa/sessions/<session-id>.jsonl
.tarae/topa/sessions/<session-id>.md
```
