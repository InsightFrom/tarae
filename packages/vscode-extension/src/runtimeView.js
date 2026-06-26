class TaraeRuntimeViewProvider {
  constructor(options) {
    this.options = options || {};
    this.view = null;
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true
    };
    webviewView.webview.html = getRuntimeViewHtml(webviewView.webview, this.options.getNonce());
    webviewView.webview.onDidReceiveMessage((message) => {
      this.handleMessage(message || {}).catch((error) => {
        this.postError(error.message || String(error));
      });
    });
    this.refresh(true);
  }

  async refresh(forceRuntime = false) {
    if (!this.view) {
      return;
    }
    const runtime = await this.options.readRuntimeStatus(forceRuntime);
    this.view.webview.postMessage({
      type: 'runtimeStatus',
      runtime
    });
  }

  async handleMessage(message) {
    switch (message.type) {
      case 'loadRuntime':
        await this.refresh(Boolean(message.forceRuntime));
        break;
      case 'upgradeLocalRuntime':
        await this.options.upgradeLocalRuntime();
        await this.refresh(true);
        break;
      case 'restartTopaDaemon':
        await this.options.restartTopaDaemon();
        await this.refresh(true);
        break;
      case 'openDashboard':
        await this.options.openDashboard();
        break;
      default:
        break;
    }
  }

  postError(message) {
    if (!this.view) {
      return;
    }
    this.view.webview.postMessage({
      type: 'error',
      message
    });
  }
}

function getRuntimeViewHtml(webview, nonce) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tarae Runtime</title>
  <style>
    :root {
      color-scheme: light dark;
      --border: var(--vscode-panel-border);
      --muted: var(--vscode-descriptionForeground);
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --panel: var(--vscode-sideBar-background);
      --ok: var(--vscode-testing-iconPassed, #3fb950);
      --warn: var(--vscode-editorWarning-foreground, #d29922);
      --bad: var(--vscode-errorForeground, #f85149);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-width: 220px;
      background: var(--panel);
      color: var(--fg);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      line-height: 1.4;
    }

    button {
      min-height: 26px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 3px;
      padding: 3px 8px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      font: inherit;
      cursor: pointer;
    }

    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .shell {
      display: grid;
      gap: 8px;
      padding: 10px;
    }

    .icons {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 5px;
    }

    .icon {
      display: grid;
      gap: 2px;
      min-width: 0;
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 6px 4px;
      background: var(--bg);
      color: var(--muted);
      text-align: center;
    }

    .icon strong {
      color: var(--fg);
      font-size: 11px;
      line-height: 1;
    }

    .icon span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 10px;
    }

    .tone-ok {
      border-color: var(--ok);
    }

    .tone-ok strong {
      color: var(--ok);
    }

    .tone-warn {
      border-color: var(--warn);
    }

    .tone-warn strong {
      color: var(--warn);
    }

    .tone-bad {
      border-color: var(--bad);
    }

    .tone-bad strong {
      color: var(--bad);
    }

    .summary,
    .card {
      display: grid;
      gap: 5px;
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 8px;
      background: var(--bg);
    }

    .summary strong,
    .card strong {
      font-size: 12px;
    }

    .muted {
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .actions {
      display: grid;
      grid-template-columns: 1fr;
      gap: 6px;
    }

    .notice {
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 7px;
      background: var(--vscode-inputValidation-infoBackground);
      color: var(--vscode-inputValidation-infoForeground);
      overflow-wrap: anywhere;
    }

    .error {
      border-color: var(--vscode-inputValidation-errorBorder);
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
    }
  </style>
</head>
<body>
  <main class="shell">
    <section id="icons" class="icons" aria-label="Runtime status"></section>
    <section id="summary" class="summary"></section>
    <section class="actions">
      <button id="refresh">Refresh</button>
      <button id="upgrade" class="secondary">Upgrade Runtime</button>
      <button id="restart" class="secondary">Restart Topa</button>
      <button id="dashboard" class="secondary">Open Dashboard</button>
    </section>
    <section id="notice"></section>
  </main>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let runtime = null;

    const els = {
      icons: document.getElementById('icons'),
      summary: document.getElementById('summary'),
      notice: document.getElementById('notice')
    };

    window.addEventListener('message', (event) => {
      const message = event.data || {};
      if (message.type === 'runtimeStatus') {
        runtime = message.runtime || null;
        render();
      } else if (message.type === 'error') {
        showNotice(message.message || 'Tarae runtime view error.', true);
      }
    });

    document.getElementById('refresh').addEventListener('click', () => post('loadRuntime', { forceRuntime: true }));
    document.getElementById('upgrade').addEventListener('click', () => post('upgradeLocalRuntime'));
    document.getElementById('restart').addEventListener('click', () => post('restartTopaDaemon'));
    document.getElementById('dashboard').addEventListener('click', () => post('openDashboard'));

    function render() {
      if (!runtime) {
        els.icons.innerHTML = [
          icon('TA', 'idle', 'tarae', 'loading'),
          icon('TO', 'idle', 'topa', 'loading'),
          icon('D', 'idle', 'daemon', 'loading'),
          icon('V', 'idle', 'version', 'loading')
        ].join('');
        els.summary.innerHTML = '<strong>Runtime</strong><div class="muted">Loading runtime status...</div>';
        return;
      }

      els.icons.innerHTML = [
        icon('TA', binaryTone(runtime.tarae), 'tarae', binaryLabel(runtime.tarae)),
        icon('TO', binaryTone(runtime.topa), 'topa', binaryLabel(runtime.topa)),
        icon('D', daemonTone(runtime.daemon), 'daemon', daemonLabel(runtime.daemon)),
        icon('V', versionTone(runtime.version), 'version', versionLabel(runtime.version))
      ].join('');

      els.summary.innerHTML =
        '<strong>' + escapeHtml(versionLabel(runtime.version)) + '</strong>' +
        '<div class="muted">' + escapeHtml(runtime.version && runtime.version.detail ? runtime.version.detail : '') + '</div>' +
        '<div class="muted">' + escapeHtml(daemonDetail(runtime.daemon)) + '</div>' +
        '<div class="muted">checked ' + escapeHtml(formatTime(runtime.checkedAt)) + '</div>';
      els.notice.innerHTML = '';
    }

    function icon(label, tone, title, detail) {
      return '<div class="icon tone-' + escapeAttr(tone || 'idle') + '" title="' + escapeAttr(title + ': ' + detail) + '">' +
        '<strong>' + escapeHtml(label) + '</strong>' +
        '<span>' + escapeHtml(detail) + '</span>' +
      '</div>';
    }

    function binaryTone(data) {
      data = data || {};
      if (!data.exists || data.error) {
        return 'bad';
      }
      return data.running ? 'ok' : 'idle';
    }

    function daemonTone(daemon) {
      daemon = daemon || {};
      if (daemon.healthy) {
        return 'ok';
      }
      if (daemon.state === 'error' || daemon.state === 'invalid-metadata') {
        return 'bad';
      }
      return daemon.metadataExists ? 'warn' : 'idle';
    }

    function versionTone(version) {
      version = version || {};
      if (version.status === 'current') {
        return 'ok';
      }
      if (version.status === 'update-needed' || version.status === 'newer') {
        return 'warn';
      }
      return 'idle';
    }

    function binaryLabel(data) {
      data = data || {};
      if (!data.exists) {
        return 'missing';
      }
      if (data.error) {
        return 'error';
      }
      return data.running ? 'running' : 'stopped';
    }

    function daemonLabel(daemon) {
      daemon = daemon || {};
      if (daemon.healthy) {
        return 'running';
      }
      if (daemon.metadataExists) {
        return daemon.state || 'unhealthy';
      }
      return 'stopped';
    }

    function daemonDetail(daemon) {
      daemon = daemon || {};
      if (daemon.healthy) {
        return 'daemon pid ' + (daemon.pid || '') + ' · v' + (daemon.version || 'unknown');
      }
      return daemon.detail || daemonLabel(daemon);
    }

    function versionLabel(version) {
      version = version || {};
      if (version.status === 'current') {
        return 'runtime current';
      }
      if (version.status === 'update-needed') {
        return 'update needed';
      }
      if (version.status === 'newer') {
        return 'runtime newer';
      }
      return 'version unknown';
    }

    function showNotice(message, isError) {
      els.notice.innerHTML = '<div class="notice ' + (isError ? 'error' : '') + '">' + escapeHtml(message) + '</div>';
    }

    function post(type, payload) {
      vscode.postMessage(Object.assign({ type }, payload || {}));
    }

    function formatTime(value) {
      if (!value) {
        return '';
      }
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleTimeString();
    }

    function escapeHtml(value) {
      return String(value || '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char]));
    }

    function escapeAttr(value) {
      return escapeHtml(value);
    }

    render();
    post('loadRuntime', { forceRuntime: true });
  </script>
</body>
</html>`;
}

module.exports = {
  TaraeRuntimeViewProvider
};
