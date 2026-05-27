# インストール

このガイドでは、Tarae をローカルプロジェクトにインストールし、AI エージェントへ MCP で接続します。

## 必要なツール

- `git`
- Node.js 18+ と `npm`
- Rust stable と `cargo`
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
