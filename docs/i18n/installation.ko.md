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

설치 스크립트는 Tarae CLI와 `topa` MCP 런타임을 설치합니다. VS Code 확장은 설치하지 않습니다. 사람용 Dashboard와 report UI가 필요할 때 Marketplace에서 별도로 설치합니다. 확장은 최초 설치를 대신하지 않지만, 이미 설치된 `~/.tarae/bin/tarae`와 `~/.tarae/bin/topa`가 확장보다 오래된 경우 확장 업데이트 후 같은 버전으로 자동 업그레이드할 수 있습니다.

AI가 README를 보고 CLI/MCP 셋업을 진행한다면 다음 순서로 충분합니다:

```bash
curl -fsSL https://raw.githubusercontent.com/InsightFrom/tarae/main/scripts/install.sh | bash
~/.tarae/bin/tarae install --agent codex --project-root "$PWD"
~/.tarae/bin/tarae verify --agent codex --project-root "$PWD"
~/.tarae/bin/tarae doctor --project-root "$PWD"
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
~/.tarae/bin/tarae upgrade --ref v0.1.10 --project-root "$PWD"
```

VS Code 확장을 사용하는 경우 확장 업데이트 후 위 업그레이드가 자동으로 실행됩니다. 자동 업그레이드는 현재 워크스페이스의 `topa` daemon만 중지하고 다른 프로젝트에는 영향을 주지 않습니다. 실패했거나 즉시 재시도하려면 Command Palette에서 `Tarae: Upgrade Local Runtime`을 실행합니다.

`upgrade` 명령이 없던 예전 설치본은 설치 스크립트를 다시 실행합니다:

```bash
curl -fsSL https://raw.githubusercontent.com/InsightFrom/tarae/main/scripts/install.sh | TARAE_REF=v0.1.10 bash
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
각 MCP 설정에는 `TARAE_AGENT_NAME`과 `TARAE_LINK_ID`가 함께 기록됩니다. 같은 프로젝트에서 여러 AI 에이전트를 병렬로 실행하는 경우 link id별 active session이 분리됩니다. 오케스트레이션 도구는 `--link-id <id>`로 고정 식별자를 지정할 수 있습니다.

지원 목록에 없는 MCP 호환 에이전트는 설정 파일 경로를 직접 지정할 수 있습니다:

```bash
tarae link my-agent --config-path ~/.my-agent/mcp.json --project-root "$PWD"
tarae link codex --project-root "$PWD" --link-id codex-backend
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

`verify`는 로컬 binary, project root, history 쓰기 가능 여부, MCP 설정, MCP tool 목록을 확인합니다. smoke test는 기록용 lifecycle 도구와 검색용 history 도구가 모두 노출되는지 확인합니다:

```text
fetch_past_context
start_session
checkpoint
report_issue
end_session
list_sessions
read_session
search_history
```

설정 후 에이전트는 작업 시작 전에 `fetch_past_context` 또는 `search_history`로 이전 작업을 찾고, 작업 중에는 `start_session`, `checkpoint`, `report_issue`, `end_session`으로 다음 에이전트가 이어받을 기록을 남기면 됩니다.

세션 이후 생성되는 파일:

```text
.tarae/topa/session_index.jsonl
.tarae/topa/latest.md
.tarae/topa/active_sessions.json
.tarae/topa/runtime/server.json
.tarae/topa/sessions/<session-id>.jsonl
.tarae/topa/sessions/<session-id>.md
```
