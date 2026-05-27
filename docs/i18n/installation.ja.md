# インストール

このガイドでは、Tarae をローカルプロジェクトにインストールし、AI エージェントへ MCP で接続します。

## 必要なツール

- `git`
- Node.js 18+ と `npm`
- ビルド済みの `topa` アーカイブを取得するための GitHub Releases へのアクセス
- ローカル MCP サーバーを起動できる AI アプリまたはエージェント

## クイックスタート

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

## PATH に追加

インストール後の CLI は `~/.tarae/bin` にあります。上の例のようにフルパスを使うか、shell profile に追加します。

```bash
export PATH="$HOME/.tarae/bin:$PATH"
```

Windows PowerShell:

```powershell
$env:Path = "$HOME\.tarae\bin;$env:Path"
```

対応エージェント:

```text
codex
cursor
claude
gemini
```

CLI は `MCP files touched` の要約で、どの設定ファイルを読み取り、バックアップし、書き込んだかを表示します。
デフォルトの MCP 設定は特定のプロジェクトに固定されません。Tarae は MCP `roots/list` または lifecycle/history ツールの `project_root` 引数からプロジェクトを決定します。どちらも使えない MCP クライアントでは `--fixed-project-root` を使えます。

対応一覧にない MCP 対応エージェントでは、設定ファイルのパスを直接指定できます:

```bash
tarae link my-agent --config-path ~/.my-agent/mcp.json --project-root "$PWD"
tarae verify --agent my-agent --config-path ~/.my-agent/mcp.json --project-root "$PWD"
```

## Topa の停止

`topa` はデーモンではなく、MCP クライアントが起動する stdio 子プロセスです。AI アプリを閉じるか再起動すると MCP 接続が閉じ、`topa` も終了します。

記録セッションは `end_session` で終了します。今後の起動を止めるには Tarae を unlink して AI アプリを再起動します:

```bash
tarae unlink codex
```

## 検証

```bash
tarae verify --agent codex --project-root "$PWD"
tarae doctor --project-root "$PWD"
```

セッション後に作成されるファイル:

```text
.tarae/topa/session_index.jsonl
.tarae/topa/latest.md
.tarae/topa/sessions/<session-id>.jsonl
.tarae/topa/sessions/<session-id>.md
```
