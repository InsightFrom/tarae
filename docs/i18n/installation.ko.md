# 설치

이 가이드는 로컬 프로젝트에 Tarae를 설치하고 AI 에이전트에 MCP로 연결합니다.

## 필요 도구

- `git`
- Node.js 18+와 `npm`
- 사전 빌드된 `topa` 아카이브를 받기 위한 GitHub 릴리스 접근
- 로컬 MCP 서버를 실행할 수 있는 AI 앱 또는 에이전트

## 빠른 시작

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/InsightFrom/tarae/main/scripts/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/InsightFrom/tarae/main/scripts/install.ps1 | iex
```

프로젝트에서 에이전트를 연결합니다:

```bash
~/.tarae/bin/tarae install --agent codex --project-root "$PWD"
```

Windows PowerShell:

```powershell
& "$HOME\.tarae\bin\tarae.ps1" install --agent codex --project-root (Get-Location)
```

## PATH 추가

설치 후 CLI는 `~/.tarae/bin` 아래에 있습니다. 위 예시처럼 전체 경로를 쓰거나 shell profile에 추가합니다.

```bash
export PATH="$HOME/.tarae/bin:$PATH"
```

Windows PowerShell:

```powershell
$env:Path = "$HOME\.tarae\bin;$env:Path"
```

지원 에이전트:

```text
codex
cursor
claude
gemini
```

CLI는 `MCP files touched` 요약으로 어떤 설정 파일을 읽고, 백업하고, 썼는지 보여줍니다.
기본 MCP 설정은 특정 프로젝트에 고정되지 않습니다. Tarae는 MCP `roots/list` 또는 lifecycle/history 도구의 `project_root` 인자로 프로젝트를 결정합니다. 둘 다 지원하지 않는 MCP 클라이언트에는 `--fixed-project-root`를 사용할 수 있습니다.

지원 목록에 없는 MCP 호환 에이전트는 설정 파일 경로를 직접 지정할 수 있습니다:

```bash
tarae link my-agent --config-path ~/.my-agent/mcp.json --project-root "$PWD"
tarae verify --agent my-agent --config-path ~/.my-agent/mcp.json --project-root "$PWD"
```

## Topa 종료

`topa`는 데몬이 아니라 MCP 클라이언트가 실행하는 stdio 자식 프로세스입니다. AI 앱을 닫거나 재시작하면 MCP 연결이 닫히면서 종료됩니다.

기록 세션은 `end_session`으로 끝냅니다. 이후 실행을 막으려면 Tarae를 unlink하고 AI 앱을 재시작합니다:

```bash
tarae unlink codex
```

## 검증

```bash
tarae verify --agent codex --project-root "$PWD"
tarae doctor --project-root "$PWD"
```

세션 이후 생성되는 파일:

```text
.tarae/topa/session_index.jsonl
.tarae/topa/latest.md
.tarae/topa/sessions/<session-id>.jsonl
.tarae/topa/sessions/<session-id>.md
```
