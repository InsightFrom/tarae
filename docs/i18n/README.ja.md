# Tarae (タレ)

[English](../../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

Tarae は AI コーディングセッションの意図、チェックポイント、エラー、変更されたファイルをプロジェクト内に記録します。小さな Rust 製 MCP サーバー `topa` がローカル履歴を書き込み、AI エージェントから検索できるようにします。

次の AI セッションが以前の判断、失敗、変更ファイルを素早く理解できるようにしたいときに使います。

## クイックスタート

必要なツール: `git`, Node.js 18+ と `npm`, GitHub Releases のビルド済み `topa` アーカイブにアクセスできるネットワーク。

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
CLI は `MCP files touched` の要約で、どの設定ファイルを読み取り、バックアップし、書き込んだかを表示します。
デフォルトの MCP 設定は特定のプロジェクトに固定されません。Tarae は MCP `roots/list` または lifecycle ツールの `project_root` 引数からプロジェクトを決定します。

対応エージェント:

```text
codex
cursor
claude
gemini
```

対応一覧にない MCP 対応エージェントでは、設定ファイルのパスを直接指定できます:

```bash
~/.tarae/bin/tarae link my-agent --config-path ~/.my-agent/mcp.json --project-root "$PWD"
~/.tarae/bin/tarae verify --agent my-agent --config-path ~/.my-agent/mcp.json --project-root "$PWD"
```

## Topa の停止

`topa` はデーモンではなく、MCP クライアントが起動する stdio 子プロセスです。AI アプリを閉じるか再起動すると MCP 接続が閉じ、`topa` も終了します。記録セッションは `end_session` で終了し、今後の起動を止めるには `tarae unlink <agent>` を実行してから AI アプリを再起動してください。

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
