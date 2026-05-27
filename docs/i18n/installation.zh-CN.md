# 安装

本指南会把 Tarae 安装到本地项目中，并通过 MCP 连接到 AI Agent。

## 需要的工具

- `git`
- Node.js 18+ 和 `npm`
- 用于下载预构建 `topa` 二进制文件的 GitHub Releases 访问权限
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

## 验证

```bash
tarae verify --agent codex --project-root "$PWD"
tarae doctor --project-root "$PWD"
```

会话后会生成的文件:

```text
.tarae/topa/session_index.jsonl
.tarae/topa/latest.md
.tarae/topa/sessions/<session-id>.jsonl
.tarae/topa/sessions/<session-id>.md
```
