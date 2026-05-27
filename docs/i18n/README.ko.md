# Tarae (타래)

[English](../../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

Tarae는 AI 코딩 세션의 의도, 체크포인트, 오류, 변경 파일 정보를 프로젝트 안에 기록합니다. 작은 Rust MCP 서버 `topa`가 로컬 히스토리를 작성하고 AI 에이전트가 다시 검색할 수 있게 합니다.

다음 AI 세션이 이전 작업의 결정, 실패, 변경 파일을 빠르게 이해해야 할 때 사용합니다.

## 빠른 시작

필요한 도구: `git`, `node`, `npm`, Rust stable과 `cargo`.

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

지원 에이전트:

```text
codex
cursor
claude
gemini
```

## 주요 기능

- `start_session`, `checkpoint`, `report_issue`, `end_session` MCP 도구 제공
- 프로젝트 안에 append-only JSONL 이벤트 로그 작성
- 같은 세션을 사람이 읽기 쉬운 Markdown으로 렌더링
- `fetch_past_context`, `list_sessions`, `read_session`, `search_history` 로컬 히스토리 도구 제공
- 파일 변경을 metadata로 기록해 자동 체크포인트와 사용자 개입 이벤트 생성

## 에이전트 사용 방식

에이전트 지침에 다음 lifecycle을 추가합니다:

```text
1. fetch_past_context()
2. start_session(objective="...")
3. checkpoint(summary="...")
4. report_issue(error_message="...")
5. end_session(summary="...")
```

다음 세션에서는 `fetch_past_context`나 `search_history`로 이전 작업 기록을 회수할 수 있습니다.

## 로컬 히스토리

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

JSONL은 `topa-event-v1` 원본 이벤트 로그입니다. Markdown은 YAML frontmatter와 timeline을 포함한 읽기용 projection입니다.

## 더 보기

- [설치 가이드](installation.ko.md)
- [Architecture](../Architecture.md)
- [Development](../../DEVELOP.md)
- [Contributing](../../CONTRIBUTING.md)
