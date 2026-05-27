# Tarae (タレ)

[English](../../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

Tarae は AI コーディングセッションの意図、チェックポイント、エラー、変更されたファイルをプロジェクト内に記録します。小さな Rust 製 MCP サーバー `topa` がローカル履歴を書き込み、AI エージェントから検索できるようにします。

次の AI セッションが以前の判断、失敗、変更ファイルを素早く理解できるようにしたいときに使います。

## クイックスタート

必要なツール: `git`, Node.js 18+ と `npm`, GitHub Releases にアクセスできるネットワーク。

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/InsightFrom/tarae/main/scripts/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/InsightFrom/tarae/main/scripts/install.ps1 | iex
```

プロジェクトでエージェントを接続します:

```bash
~/.tarae/bin/tarae install --agent codex --project-root "$PWD"
```

Windows PowerShell:

```powershell
& "$HOME\.tarae\bin\tarae.ps1" install --agent codex --project-root (Get-Location)
```

MCP 設定を読み直すため、接続後に対象の AI アプリを再起動してください。

対応エージェント:

```text
codex
cursor
claude
gemini
```

## 機能

- MCP ライフサイクルツール: `start_session`, `checkpoint`, `report_issue`, `end_session`
- プロジェクト内に追記型 JSONL イベントログを作成
- 人間と AI エージェントが読める Markdown セッション表示
- ローカル履歴ツール: `fetch_past_context`, `list_sessions`, `read_session`, `search_history`
- ファイル変更をメタデータとして追跡し、自動チェックポイントと人間の介入イベントを記録

## エージェントでの使い方

エージェントの指示に次の lifecycle を追加します:

```text
1. fetch_past_context()
2. start_session(objective="...")
3. checkpoint(summary="...")
4. report_issue(error_message="...")
5. end_session(summary="...")
```

次のセッションでは `fetch_past_context` または `search_history` で以前の作業履歴を取り戻せます。

## ローカル履歴

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

JSONL は正規の `topa-event-v1` イベントログです。Markdown は YAML frontmatter と timeline を含む読みやすい projection です。

## 詳細

- [Installation](installation.ja.md)
- [Architecture](../Architecture.md)
- [Development](../../DEVELOP.md)
- [Contributing](../../CONTRIBUTING.md)
