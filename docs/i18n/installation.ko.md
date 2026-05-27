# 설치

이 가이드는 로컬 프로젝트에 Tarae를 설치하고 AI 에이전트에 MCP로 연결합니다.

## 필요 도구

- `git`
- Node.js 18+와 `npm`
- 사전 빌드된 `topa` 바이너리를 받기 위한 GitHub 릴리스 접근
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
