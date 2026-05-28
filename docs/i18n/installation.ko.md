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

## 업그레이드

기존 설치를 갱신할 때는 오래된 npm/global `tarae`가 먼저 잡히지 않도록 `~/.tarae/bin/tarae` shim을 우선 사용합니다:

```bash
command -v tarae
tarae --version
~/.tarae/bin/tarae --version
~/.tarae/bin/topa --version
~/.tarae/bin/tarae verify --project-root "$PWD" --no-mcp-smoke
```

릴리스 버전으로 업그레이드:

```bash
~/.tarae/bin/tarae upgrade --ref v0.1.5 --project-root "$PWD"
```

`upgrade` 명령이 없던 예전 설치본은 설치 스크립트를 다시 실행합니다:

```bash
curl -fsSL https://raw.githubusercontent.com/InsightFrom/tarae/main/scripts/install.sh | TARAE_REF=v0.1.5 bash
```

아직 릴리스되지 않은 branch를 검증할 때는 최신 릴리스 asset을 받지 말고 source에서 `topa`를 빌드합니다:

```bash
~/.tarae/bin/tarae upgrade --ref main --build-from-source --project-root "$PWD"
```

업그레이드 후에는 기존 MCP stdio bridge 프로세스가 교체되도록 AI 앱을 재시작합니다.

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

`topa serve`는 MCP stdio 호환을 위한 가벼운 브리지입니다. 첫 lifecycle 도구 호출 때 프로젝트별 `topa daemon`을 시작하거나 재사용하며, 이 데몬 하나가 파일 감시, 활성 세션 상태, 히스토리 쓰기를 담당합니다.

기록 세션은 `end_session`으로 끝냅니다. 프로젝트 데몬은 다음 명령으로 종료할 수 있습니다:

```bash
topa shutdown --project-root "$PWD"
```

이후 실행을 막으려면 Tarae를 unlink하고 AI 앱을 재시작합니다:

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
.tarae/topa/runtime/server.json
.tarae/topa/sessions/<session-id>.jsonl
.tarae/topa/sessions/<session-id>.md
```
