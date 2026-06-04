function getDashboardHtml(webview, nonce) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tarae Dashboard</title>
  <style>
    :root {
      color-scheme: light dark;
      --gap: 12px;
      --border: var(--vscode-panel-border);
      --muted: var(--vscode-descriptionForeground);
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --panel: var(--vscode-sideBar-background);
      --focus: var(--vscode-focusBorder);
      --accent: var(--vscode-button-background);
      --accent-fg: var(--vscode-button-foreground);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-width: 320px;
      background: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      line-height: 1.45;
    }

    button,
    input,
    select {
      font: inherit;
    }

    button {
      min-height: 28px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 3px;
      padding: 4px 10px;
      background: var(--accent);
      color: var(--accent-fg);
      cursor: pointer;
    }

    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }

    input,
    select {
      width: 100%;
      min-height: 28px;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 3px;
      padding: 4px 7px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
    }

    label {
      display: grid;
      gap: 4px;
      min-width: 0;
      color: var(--muted);
      font-size: 12px;
    }

    .shell {
      display: grid;
      grid-template-rows: auto auto 1fr;
      height: 100vh;
      min-height: 520px;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--gap);
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      background: var(--panel);
    }

    .title {
      min-width: 0;
    }

    .title h1 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
    }

    .title p {
      margin: 2px 0 0;
      color: var(--muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .filters {
      display: grid;
      grid-template-columns: minmax(160px, 2fr) repeat(6, minmax(110px, 1fr)) auto auto;
      gap: 8px;
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
      align-items: end;
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(260px, 34%) minmax(0, 1fr);
      min-height: 0;
    }

    .sidebar,
    .detail {
      min-height: 0;
      overflow: auto;
    }

    .sidebar {
      border-right: 1px solid var(--border);
      background: var(--vscode-sideBar-background);
    }

    .section-header {
      position: sticky;
      top: 0;
      z-index: 1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 9px 12px;
      border-bottom: 1px solid var(--border);
      background: var(--vscode-sideBar-background);
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
    }

    .session-list,
    .hit-list,
    .timeline,
    .file-list {
      display: grid;
      gap: 1px;
    }

    .session-row {
      display: grid;
      gap: 5px;
      width: 100%;
      padding: 10px 12px;
      border: 0;
      border-left: 3px solid transparent;
      background: transparent;
      color: var(--fg);
      text-align: left;
      cursor: pointer;
    }

    .session-row:hover,
    .session-row.selected {
      background: var(--vscode-list-hoverBackground);
    }

    .session-row.selected {
      border-left-color: var(--focus);
    }

    .session-title {
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    .meta {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
      color: var(--muted);
      font-size: 12px;
    }

    .pill {
      display: inline-flex;
      max-width: 100%;
      align-items: center;
      min-height: 20px;
      border: 1px solid var(--border);
      border-radius: 3px;
      padding: 1px 5px;
      color: var(--muted);
      overflow-wrap: anywhere;
    }

    .detail {
      padding: 16px;
    }

    .detail-grid {
      display: grid;
      gap: 16px;
      max-width: 1180px;
    }

    .band {
      display: grid;
      gap: 10px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 14px;
    }

    .band h2,
    .band h3 {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
    }

    .band h3 {
      font-size: 13px;
    }

    .summary {
      margin: 0;
      color: var(--muted);
      overflow-wrap: anywhere;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 8px;
    }

    .stat {
      display: grid;
      gap: 2px;
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 8px;
      background: var(--vscode-editorWidget-background);
    }

    .stat strong {
      font-size: 17px;
    }

    .stat span {
      color: var(--muted);
      font-size: 12px;
    }

    .event,
    .file-row,
    .hit-row {
      display: grid;
      gap: 5px;
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 9px;
      background: var(--vscode-editorWidget-background);
    }

    .event-title,
    .file-title {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
    }

    .event-title strong,
    .file-title strong {
      overflow-wrap: anywhere;
    }

    .event-title span,
    .file-title span,
    .muted {
      color: var(--muted);
      font-size: 12px;
    }

    .scope-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 8px;
    }

    .scope-list ul {
      margin: 4px 0 0;
      padding-left: 18px;
    }

    .report-preview {
      width: 100%;
      min-height: 260px;
      resize: vertical;
      white-space: pre;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
    }

    .empty {
      padding: 24px;
      color: var(--muted);
      text-align: center;
    }

    .notice {
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 10px;
      background: var(--vscode-inputValidation-infoBackground);
      color: var(--vscode-inputValidation-infoForeground);
      overflow-wrap: anywhere;
    }

    .error {
      border-color: var(--vscode-inputValidation-errorBorder);
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
    }

    @media (max-width: 980px) {
      .filters {
        grid-template-columns: repeat(2, minmax(120px, 1fr));
      }

      .layout {
        grid-template-columns: 1fr;
      }

      .sidebar {
        max-height: 40vh;
        border-right: 0;
        border-bottom: 1px solid var(--border);
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div class="title">
        <h1>Tarae Dashboard</h1>
        <p id="project-root">Loading workspace history...</p>
      </div>
      <div class="actions">
        <button id="refresh">Refresh</button>
        <button id="restart-topa" class="secondary">Restart Topa</button>
        <button id="configure" class="secondary">Configure LLM</button>
        <button id="clear-credentials" class="secondary">Clear Credentials</button>
      </div>
    </header>

    <section class="filters">
      <label>Keyword<input id="filter-keyword" type="search" placeholder="summary, objective, error"></label>
      <label>File<input id="filter-file" type="search" placeholder="packages/watcher"></label>
      <label>Agent<input id="filter-agent" type="search" placeholder="codex"></label>
      <label>Link<input id="filter-link" type="search" placeholder="codex-main"></label>
      <label>Status<select id="filter-status"><option value="">Any</option><option value="active">active</option><option value="completed">completed</option><option value="unknown">unknown</option></select></label>
      <label>Tag<input id="filter-tag" type="search" placeholder="#release"></label>
      <label>After<input id="filter-after" type="date"></label>
      <label>Before<input id="filter-before" type="date"></label>
      <button id="apply-search">Search</button>
      <button id="clear-search" class="secondary">Clear</button>
    </section>

    <main class="layout">
      <aside class="sidebar">
        <div class="section-header"><span>Sessions</span><span id="session-count">0</span></div>
        <div id="session-list" class="session-list"></div>
        <div class="section-header"><span>Event Matches</span><span id="hit-count">0</span></div>
        <div id="hit-list" class="hit-list"></div>
      </aside>
      <section id="detail" class="detail">
        <div class="empty">Select a Tarae session to inspect its timeline, file changes, and report scope.</div>
      </section>
    </main>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const state = {
      projectRoot: '',
      sessions: [],
      activeSessions: [],
      selectedSessionId: '',
      detail: null,
      searchHits: [],
      lastQuery: '',
      llm: { provider: 'openai', model: 'gpt-4.1-mini', hasCredentials: false },
      generatedReport: null,
      pending: false
    };

    const els = {
      projectRoot: document.getElementById('project-root'),
      sessionList: document.getElementById('session-list'),
      hitList: document.getElementById('hit-list'),
      sessionCount: document.getElementById('session-count'),
      hitCount: document.getElementById('hit-count'),
      detail: document.getElementById('detail'),
      keyword: document.getElementById('filter-keyword'),
      file: document.getElementById('filter-file'),
      agent: document.getElementById('filter-agent'),
      link: document.getElementById('filter-link'),
      status: document.getElementById('filter-status'),
      tag: document.getElementById('filter-tag'),
      after: document.getElementById('filter-after'),
      before: document.getElementById('filter-before')
    };

    window.addEventListener('message', (event) => {
      const message = event.data || {};
      if (message.type === 'dashboardData') {
        state.projectRoot = message.data.projectRoot || '';
        state.sessions = message.data.sessions || [];
        state.activeSessions = message.data.activeSessions || [];
        state.llm = message.llm || state.llm;
        els.projectRoot.textContent = state.projectRoot || 'No workspace folder';
        renderSessions();
        if (!state.selectedSessionId && state.sessions.length) {
          selectSession(state.sessions[0].session_id);
        }
      } else if (message.type === 'sessionDetail') {
        state.detail = message.detail;
        state.selectedSessionId = message.detail && message.detail.entry ? message.detail.entry.session_id : '';
        state.generatedReport = null;
        renderSessions();
        renderDetail();
      } else if (message.type === 'searchResults') {
        state.searchHits = message.hits || [];
        renderSessions();
        renderHits();
      } else if (message.type === 'llmState') {
        state.llm = message.llm || state.llm;
        renderDetail();
      } else if (message.type === 'reportGenerated') {
        state.pending = false;
        state.generatedReport = {
          reportId: message.reportId,
          markdown: message.markdown || '',
          savedPath: message.savedPath || ''
        };
        renderDetail();
      } else if (message.type === 'reportSaved') {
        if (state.generatedReport) {
          state.generatedReport.savedPath = message.path || '';
        }
        renderDetail();
      } else if (message.type === 'error') {
        state.pending = false;
        showNotice(message.message || 'Tarae dashboard error.', true);
      }
    });

    document.getElementById('refresh').addEventListener('click', () => {
      post('loadDashboard', { selectedSessionId: state.selectedSessionId });
    });
    document.getElementById('restart-topa').addEventListener('click', () => post('restartTopaDaemon'));
    document.getElementById('configure').addEventListener('click', () => post('configureLlm'));
    document.getElementById('clear-credentials').addEventListener('click', () => post('clearLlmCredentials'));
    document.getElementById('apply-search').addEventListener('click', () => runSearch());
    document.getElementById('clear-search').addEventListener('click', () => {
      for (const input of [els.keyword, els.file, els.agent, els.link, els.status, els.tag, els.after, els.before]) {
        input.value = '';
      }
      state.lastQuery = '';
      state.searchHits = [];
      renderSessions();
      renderHits();
    });

    els.sessionList.addEventListener('click', (event) => {
      const row = event.target.closest('[data-session-id]');
      if (row) {
        selectSession(row.dataset.sessionId);
      }
    });

    els.hitList.addEventListener('click', (event) => {
      const row = event.target.closest('[data-session-id]');
      if (row) {
        selectSession(row.dataset.sessionId);
      }
    });

    els.detail.addEventListener('click', (event) => {
      const action = event.target.dataset.action;
      if (!action) {
        return;
      }
      if (action === 'openMarkdown' && state.selectedSessionId) {
        post('openSession', { sessionId: state.selectedSessionId });
      } else if (action === 'generateReport' && state.selectedSessionId) {
        state.pending = true;
        renderDetail();
        post('generateReport', { sessionId: state.selectedSessionId });
      } else if (action === 'saveReport' && state.generatedReport) {
        post('saveReport', { reportId: state.generatedReport.reportId });
      }
    });

    function selectSession(sessionId) {
      if (!sessionId) {
        return;
      }
      state.selectedSessionId = sessionId;
      renderSessions();
      post('loadSession', { sessionId });
    }

    function runSearch() {
      state.lastQuery = buildQuery();
      if (!state.lastQuery) {
        state.searchHits = [];
        renderSessions();
        renderHits();
        return;
      }
      post('search', { query: state.lastQuery });
    }

    function buildQuery() {
      const tokens = [];
      addToken(tokens, '', els.keyword.value);
      addToken(tokens, 'file', els.file.value);
      addToken(tokens, 'agent', els.agent.value);
      addToken(tokens, 'link', els.link.value);
      addToken(tokens, 'status', els.status.value);
      addToken(tokens, 'tag', els.tag.value);
      addToken(tokens, 'after', els.after.value);
      addToken(tokens, 'before', els.before.value);
      return tokens.join(' ');
    }

    function addToken(tokens, prefix, value) {
      const trimmed = String(value || '').trim();
      if (!trimmed) {
        return;
      }
      tokens.push(prefix ? prefix + ':' + quoteToken(trimmed) : quoteToken(trimmed));
    }

    function quoteToken(value) {
      return /\\s/.test(value) ? '"' + value.replace(/"/g, '') + '"' : value;
    }

    function renderSessions() {
      const visible = visibleSessions();
      els.sessionCount.textContent = String(visible.length);
      if (!visible.length) {
        els.sessionList.innerHTML = '<div class="empty">No sessions match the current filters.</div>';
        return;
      }

      els.sessionList.innerHTML = visible.map((session) => {
        const selected = session.session_id === state.selectedSessionId ? ' selected' : '';
        const title = escapeHtml(session.objective || session.session_id);
        const updated = session.updated_at ? formatDate(session.updated_at) : 'No timestamp';
        const agent = session.agent_name ? '<span class="pill">agent: ' + escapeHtml(session.agent_name) + '</span>' : '';
        const link = session.link_id ? '<span class="pill">link: ' + escapeHtml(session.link_id) + '</span>' : '';
        const tags = (session.tags || []).slice(0, 3).map((tag) => '<span class="pill">' + escapeHtml(tag) + '</span>').join('');
        return '<button class="session-row' + selected + '" data-session-id="' + escapeAttr(session.session_id) + '">' +
          '<span class="session-title">' + title + '</span>' +
          '<span class="meta"><span class="pill">' + escapeHtml(session.status || 'unknown') + '</span><span>' + escapeHtml(updated) + '</span><span>' + Number(session.event_count || 0) + ' events</span></span>' +
          '<span class="meta">' + agent + link + tags + '</span>' +
        '</button>';
      }).join('');
    }

    function visibleSessions() {
      if (!state.lastQuery) {
        return state.sessions;
      }
      const sessionIds = new Set(state.searchHits.map((hit) => hit.session_id));
      return state.sessions.filter((session) => sessionIds.has(session.session_id));
    }

    function renderHits() {
      els.hitCount.textContent = String(state.searchHits.length);
      if (!state.lastQuery) {
        els.hitList.innerHTML = '<div class="empty">Run a search to see event matches.</div>';
        return;
      }
      if (!state.searchHits.length) {
        els.hitList.innerHTML = '<div class="empty">No event matches.</div>';
        return;
      }
      els.hitList.innerHTML = state.searchHits.slice(0, 40).map((hit) => (
        '<button class="session-row hit-row" data-session-id="' + escapeAttr(hit.session_id) + '">' +
          '<span class="session-title">' + escapeHtml(hit.label || hit.event.event_type || 'event') + '</span>' +
          '<span class="meta">' + escapeHtml(hit.description || hit.session_id) + '</span>' +
          '<span class="muted">' + escapeHtml(hit.detail || '') + '</span>' +
        '</button>'
      )).join('');
    }

    function renderDetail() {
      const detail = state.detail;
      if (!detail || !detail.entry) {
        els.detail.innerHTML = '<div class="empty">Select a Tarae session to inspect its timeline, file changes, and report scope.</div>';
        return;
      }

      const entry = detail.entry;
      const scope = detail.reportScope || {};
      const report = state.generatedReport;
      const credentials = state.llm.hasCredentials ? 'configured' : 'not configured';
      const pending = state.pending ? '<div class="notice">Generating report. This may take a moment.</div>' : '';
      const saved = report && report.savedPath ? '<div class="notice">Saved report: ' + escapeHtml(report.savedPath) + '</div>' : '';
      const preview = report ? '<textarea class="report-preview" readonly>' + escapeHtml(report.markdown) + '</textarea>' : '';
      const reportActions = report
        ? '<button data-action="saveReport"' + (report.savedPath ? ' disabled' : '') + '>Save Report</button>'
        : '';

      els.detail.innerHTML = '<div class="detail-grid">' +
        '<section class="band">' +
          '<div class="event-title"><h2>' + escapeHtml(entry.objective || entry.session_id) + '</h2><span>' + escapeHtml(entry.status || 'unknown') + '</span></div>' +
          '<p class="summary">' + escapeHtml(entry.last_summary || 'No summary recorded.') + '</p>' +
          '<div class="meta">' + metaPill('session', entry.session_id) + metaPill('agent', entry.agent_name) + metaPill('link', entry.link_id) + metaPill('updated', formatDate(entry.updated_at)) + '</div>' +
          '<div class="actions"><button data-action="openMarkdown" class="secondary">Open Markdown</button><button data-action="generateReport" ' + (state.pending ? 'disabled' : '') + '>Generate Report</button>' + reportActions + '</div>' +
        '</section>' +
        renderStats(detail, scope) +
        renderScope(scope, credentials) +
        pending + saved +
        (preview ? '<section class="band"><h3>Report Preview</h3>' + preview + '</section>' : '') +
        renderFiles(detail.fileChanges || []) +
        renderTimeline(detail.events || []) +
      '</div>';
    }

    function renderStats(detail, scope) {
      return '<section class="band"><div class="stats">' +
        stat(scope.event_count || (detail.events || []).length, 'events') +
        stat(scope.file_count || (detail.fileChanges || []).length, 'files') +
        stat(scope.issue_count || (detail.issues || []).length, 'issues') +
        stat(scope.markdown_chars || 0, 'markdown chars') +
      '</div></section>';
    }

    function renderScope(scope, credentials) {
      return '<section class="band">' +
        '<h3>Report Scope</h3>' +
        '<p class="summary">LLM provider: ' + escapeHtml(state.llm.provider) + ' / ' + escapeHtml(state.llm.model) + ' / credentials ' + escapeHtml(credentials) + '.</p>' +
        '<div class="scope-list">' +
          '<div><strong>Included</strong><ul>' + listItems(scope.includes || []) + '</ul></div>' +
          '<div><strong>Excluded</strong><ul>' + listItems(scope.excludes || []) + '</ul></div>' +
        '</div>' +
        '<p class="muted">' + escapeHtml(scope.ignore_policy || '') + '</p>' +
      '</section>';
    }

    function renderFiles(files) {
      if (!files.length) {
        return '<section class="band"><h3>Files Changed</h3><div class="empty">No file changes recorded.</div></section>';
      }
      return '<section class="band"><h3>Files Changed</h3><div class="file-list">' + files.map((file) => (
        '<div class="file-row">' +
          '<div class="file-title"><strong>' + escapeHtml(file.path || '(unknown)') + '</strong><span>' + escapeHtml(file.action || 'modified') + '</span></div>' +
          '<div class="meta"><span>+' + Number(file.lines_added || 0) + '</span><span>-' + Number(file.lines_removed || 0) + '</span><span>' + (file.events || []).length + ' related events</span></div>' +
        '</div>'
      )).join('') + '</div></section>';
    }

    function renderTimeline(events) {
      if (!events.length) {
        return '<section class="band"><h3>Timeline</h3><div class="empty">No JSONL events recorded.</div></section>';
      }
      return '<section class="band"><h3>Timeline</h3><div class="timeline">' + events.map((event) => {
        const attribution = event.attribution
          ? '<span class="pill">attribution: ' + escapeHtml(event.attribution.status || 'unknown') + '</span>'
          : '';
        const actor = event.actor || {};
        return '<div class="event">' +
          '<div class="event-title"><strong>' + escapeHtml(event.event_type || 'event') + '</strong><span>' + escapeHtml(formatDate(event.timestamp)) + '</span></div>' +
          '<p class="summary">' + escapeHtml(event.summary || '') + '</p>' +
          '<div class="meta">' + metaPill('actor', actor.agent_name || actor.type) + metaPill('link', actor.link_id) + attribution + '</div>' +
        '</div>';
      }).join('') + '</div></section>';
    }

    function stat(value, label) {
      return '<div class="stat"><strong>' + escapeHtml(String(value)) + '</strong><span>' + escapeHtml(label) + '</span></div>';
    }

    function listItems(items) {
      return items.map((item) => '<li>' + escapeHtml(item) + '</li>').join('');
    }

    function metaPill(label, value) {
      if (!value) {
        return '';
      }
      return '<span class="pill">' + escapeHtml(label) + ': ' + escapeHtml(value) + '</span>';
    }

    function showNotice(message, isError) {
      els.detail.insertAdjacentHTML('afterbegin', '<div class="notice ' + (isError ? 'error' : '') + '">' + escapeHtml(message) + '</div>');
    }

    function post(type, payload) {
      vscode.postMessage(Object.assign({ type }, payload || {}));
    }

    function formatDate(value) {
      if (!value) {
        return '';
      }
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
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

    post('loadDashboard', { selectedSessionId: state.selectedSessionId });
  </script>
</body>
</html>`;
}

module.exports = {
  getDashboardHtml
};
