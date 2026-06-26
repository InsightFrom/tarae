# Tarae (타래)

[English](../../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

Tarae는 AI 코딩 세션의 의도, 체크포인트, 오류, 변경 파일 정보를 프로젝트 안에 기록합니다. 작은 Rust MCP 서버 `topa`가 로컬 히스토리를 작성하고 AI 에이전트가 다시 검색할 수 있게 합니다.

다음 AI 세션이 이전 작업의 결정, 실패, 변경 파일을 빠르게 이해해야 할 때 사용합니다.

## 빠른 시작

필요한 도구: `git`, Node.js 18+와 `npm`, GitHub 릴리스의 사전 빌드 `topa` 아카이브에 접근할 수 있는 네트워크.

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

MCP 설정을 다시 읽도록 대상 AI 앱을 재시작합니다.
CLI는 `MCP files touched` 요약으로 어떤 설정 파일을 읽고, 백업하고, 썼는지 보여줍니다.
기본 MCP 설정은 특정 프로젝트에 고정되지 않습니다. Tarae는 MCP `roots/list` 또는 lifecycle 도구의 `project_root` 인자로 프로젝트를 결정합니다.

설치 스크립트는 Tarae CLI와 `topa` MCP 런타임을 설치합니다. VS Code 확장은 사람을 위한 Dashboard가 필요할 때 Marketplace에서 별도로 설치합니다. 확장은 최초 설치를 대신하지 않지만, 이미 설치된 `~/.tarae/bin/tarae`와 `~/.tarae/bin/topa`가 확장보다 오래된 경우 확장 업데이트 후 같은 버전으로 자동 업그레이드할 수 있습니다.

지원 에이전트:

```text
codex
cursor
claude
gemini
```

지원 목록에 없는 MCP 호환 에이전트는 설정 파일 경로를 직접 지정할 수 있습니다:

```bash
~/.tarae/bin/tarae link my-agent --config-path ~/.my-agent/mcp.json --project-root "$PWD"
~/.tarae/bin/tarae verify --agent my-agent --config-path ~/.my-agent/mcp.json --project-root "$PWD"
```

각 MCP 연결에는 `TARAE_AGENT_NAME`과 `TARAE_LINK_ID`가 기록됩니다. 여러 AI 에이전트가 같은 프로젝트에서 동시에 작업해도 link id별 active session을 따로 추적할 수 있으며, 오케스트레이션 도구는 `--link-id <id>`로 고정 식별자를 지정할 수 있습니다.

## Topa 종료

`topa serve`는 MCP stdio 호환을 위한 가벼운 브리지입니다. 첫 lifecycle 도구 호출 때 프로젝트별 `topa daemon`을 시작하거나 재사용하며, 이 데몬 하나가 파일 감시, 활성 세션 상태, 히스토리 쓰기를 담당합니다. 기록 세션은 `end_session`으로 끝내고, 프로젝트 데몬은 `topa shutdown --project-root "$PWD"`로 종료할 수 있습니다. 이후 실행을 막으려면 `tarae unlink <agent>` 후 AI 앱을 재시작하세요.

## 주요 기능

- `start_session`, `checkpoint`, `report_issue`, `end_session` MCP 도구 제공
- 프로젝트 안에 append-only JSONL 이벤트 로그 작성
- 같은 세션을 사람이 읽기 쉬운 Markdown으로 렌더링
- `fetch_past_context`, `list_sessions`, `read_session`, `search_history` 로컬 히스토리 도구 제공
- 파일 변경을 metadata로 기록해 자동 체크포인트와 사용자 개입 이벤트 생성
- MCP `link_id` 기준으로 Codex, Claude, Gemini 같은 병렬 AI 에이전트의 active session을 분리 추적

## 에이전트 사용 방식

Tarae는 에이전트를 위한 로컬 프로젝트 메모리 계층으로 동작합니다. 에이전트는 lifecycle 도구로 진행 상황을 기록하고, 다음 작업자는 MCP history 도구로 이전 작업을 검색해 이어받을 수 있습니다.

에이전트 지침에 다음 lifecycle을 추가합니다:

```text
1. fetch_past_context(project_root="...") # roots/list를 사용할 수 없을 때
2. start_session(objective="...", project_root="...") # roots/list를 사용할 수 없을 때
3. checkpoint(summary="...")
4. report_issue(error_message="...")
5. end_session(summary="...")
```

`checkpoint.summary`와 `end_session.summary`는 반드시 사용자 대화 언어로 작성합니다. 사용자가 한국어로 작업 중이면 세션 기록도 한국어로 남깁니다.

다음 세션에서는 `fetch_past_context`, `search_history`, `list_sessions`, `read_session`으로 이전 결정, 실패 로그, 변경 파일, 담당 agent, MCP link id, tag, 시간 범위를 검색할 수 있습니다.

VS Code 확장 없이 AI가 설치와 셋업만 검증하려면 다음 명령이면 충분합니다:

```bash
~/.tarae/bin/tarae verify --agent codex --project-root "$PWD"
~/.tarae/bin/tarae doctor --project-root "$PWD"
```

## 로컬 히스토리

```text
.tarae/
└── topa/
    ├── active_session.json
    ├── active_sessions.json
    ├── latest.md
    ├── runtime/
    │   └── server.json
    ├── session_index.jsonl
    └── sessions/
        ├── <session-id>.jsonl
        └── <session-id>.md
```

JSONL은 `topa-event-v1` 원본 이벤트 로그입니다. Markdown은 YAML frontmatter와 timeline을 포함한 읽기용 projection입니다. 이벤트에는 agent/link 식별자와 watcher attribution 상태가 포함될 수 있습니다.

## 더 보기

- [설치 가이드](installation.ko.md)
- [Architecture](../Architecture.md)
- [Development](../../DEVELOP.md)
- [Contributing](../../CONTRIBUTING.md)
