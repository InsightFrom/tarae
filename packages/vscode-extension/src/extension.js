const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const { getDashboardHtml } = require('./dashboard');
const {
  compactDescription,
  getSessionDetail,
  readDashboardData,
  readHistory,
  searchHistory,
  sessionTooltip
} = require('./history');
const {
  MissingCredentialsError,
  clearLlmCredentials,
  configureLlmProvider,
  generateSessionReport,
  getLlmState
} = require('./llmProvider');
const {
  buildReportContext,
  saveReport
} = require('./reports');
const {
  restartProjectDaemonAfterUpdate,
  restartProjectDaemonCommand
} = require('./topaDaemon');

const TARAE_SCHEME = 'tarae-session';

let dashboardPanel = null;
let pendingDashboardSessionId = '';
const reportCache = new Map();

function activate(context) {
  const provider = new TaraeSessionsProvider(() => refreshDashboard(context));
  const contentProvider = new TaraeMarkdownProvider();
  restartProjectDaemonAfterExtensionUpdate(context, provider);

  context.subscriptions.push(
    provider,
    vscode.window.registerTreeDataProvider('tarae.sessions', provider),
    vscode.workspace.registerTextDocumentContentProvider(TARAE_SCHEME, contentProvider),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh()),
    vscode.commands.registerCommand('tarae.refreshSessions', () => provider.refresh()),
    vscode.commands.registerCommand('tarae.openDashboard', (item) => openDashboard(context, provider, item)),
    vscode.commands.registerCommand('tarae.openLatestSession', () => openLatestSession(provider)),
    vscode.commands.registerCommand('tarae.listSessions', () => listSessions(provider)),
    vscode.commands.registerCommand('tarae.searchHistory', () => searchHistoryCommand(provider)),
    vscode.commands.registerCommand('tarae.openSessionMarkdown', (item) => openSessionMarkdown(provider, item)),
    vscode.commands.registerCommand('tarae.configureLlmProvider', async () => {
      await configureLlmProvider(context);
      await sendLlmState(context);
    }),
    vscode.commands.registerCommand('tarae.clearLlmCredentials', async () => {
      await clearLlmCredentials(context);
      await sendLlmState(context);
    }),
    vscode.commands.registerCommand('tarae.generateSessionReport', (item) => generateSessionReportCommand(context, provider, item)),
    vscode.commands.registerCommand('tarae.restartTopaDaemon', async () => {
      await restartProjectDaemonCommand(getProjectRoot());
      provider.refresh();
    })
  );
}

function deactivate() {}

function restartProjectDaemonAfterExtensionUpdate(context, provider) {
  restartProjectDaemonAfterUpdate(context, getProjectRoot())
    .then((result) => {
      if (!result || !result.restarted) {
        return;
      }
      provider.refresh();
      vscode.window.showInformationMessage(
        'Tarae extension updated. Restarted the topa daemon for this workspace.'
      );
    })
    .catch((error) => {
      const message = error && error.message ? error.message : String(error);
      vscode.window.showWarningMessage(`Tarae extension updated, but topa daemon restart failed: ${message}`);
    });
}

class TaraeSessionsProvider {
  constructor(onHistoryChanged) {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.onHistoryChanged = onHistoryChanged;
    this.watchers = [];
    this.resetWatchers();
  }

  refresh() {
    this.resetWatchers();
    this._onDidChangeTreeData.fire();
    if (this.onHistoryChanged) {
      this.onHistoryChanged();
    }
  }

  getTreeItem(item) {
    return item;
  }

  getChildren(item) {
    if (item) {
      return [];
    }

    const root = getProjectRoot();
    if (!root) {
      return [new MessageItem('Open a workspace folder to view Tarae history.')];
    }

    const history = readHistory(root);
    const items = [];

    if (history.latestMarkdownPath) {
      items.push(new LatestItem(history.latestMarkdownPath));
    }

    for (const entry of history.sessions) {
      items.push(new SessionItem(entry));
    }

    if (items.length === 0) {
      return [new MessageItem('No Tarae history found in .tarae/topa yet.')];
    }

    return items;
  }

  sessions() {
    const root = getProjectRoot();
    return root ? readHistory(root).sessions : [];
  }

  latestMarkdownPath() {
    const root = getProjectRoot();
    return root ? readHistory(root).latestMarkdownPath : null;
  }

  resetWatchers() {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];

    for (const folder of vscode.workspace.workspaceFolders || []) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, '.tarae/topa/**')
      );
      watcher.onDidCreate(() => this.notifyHistoryChanged());
      watcher.onDidChange(() => this.notifyHistoryChanged());
      watcher.onDidDelete(() => this.notifyHistoryChanged());
      this.watchers.push(watcher);
    }
  }

  notifyHistoryChanged() {
    this._onDidChangeTreeData.fire();
    if (this.onHistoryChanged) {
      this.onHistoryChanged();
    }
  }

  dispose() {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];
    this._onDidChangeTreeData.dispose();
  }
}

class LatestItem extends vscode.TreeItem {
  constructor(markdownPath) {
    super('Latest Session', vscode.TreeItemCollapsibleState.None);
    this.description = path.basename(markdownPath);
    this.tooltip = markdownPath;
    this.iconPath = new vscode.ThemeIcon('history');
    this.command = {
      command: 'tarae.openLatestSession',
      title: 'Open Latest Session'
    };
  }
}

class SessionItem extends vscode.TreeItem {
  constructor(entry) {
    super(entry.objective || entry.session_id, vscode.TreeItemCollapsibleState.None);
    this.entry = entry;
    this.contextValue = 'taraeSession';
    this.description = compactDescription(entry);
    this.tooltip = sessionTooltip(entry);
    this.iconPath = new vscode.ThemeIcon(entry.status === 'completed' ? 'check' : 'debug-start');
    this.command = {
      command: 'tarae.openSessionMarkdown',
      title: 'Open Session Markdown',
      arguments: [this]
    };
  }
}

class MessageItem extends vscode.TreeItem {
  constructor(label) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('info');
  }
}

class TaraeMarkdownProvider {
  provideTextDocumentContent(uri) {
    const filePath = decodeTaraeUri(uri);
    if (!filePath || !fs.existsSync(filePath)) {
      return `Tarae session file not found: ${filePath || uri.toString()}`;
    }
    return fs.readFileSync(filePath, 'utf8');
  }
}

async function openDashboard(context, provider, item) {
  const entry = item && item.entry ? item.entry : item;
  pendingDashboardSessionId = entry && entry.session_id ? entry.session_id : pendingDashboardSessionId;

  if (dashboardPanel) {
    dashboardPanel.reveal(vscode.ViewColumn.One);
    await sendDashboardData(context);
    return;
  }

  dashboardPanel = vscode.window.createWebviewPanel(
    'tarae.dashboard',
    'Tarae Dashboard',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true
    }
  );
  dashboardPanel.webview.html = getDashboardHtml(dashboardPanel.webview, getNonce());

  dashboardPanel.onDidDispose(() => {
    dashboardPanel = null;
    pendingDashboardSessionId = '';
  });

  dashboardPanel.webview.onDidReceiveMessage((message) => {
    handleDashboardMessage(context, provider, message).catch((error) => {
      postDashboardError(error.message || String(error));
    });
  });
}

async function handleDashboardMessage(context, provider, message) {
  switch (message.type) {
    case 'loadDashboard':
      await sendDashboardData(context, message.selectedSessionId || '');
      break;
    case 'loadSession':
      await sendSessionDetail(message.sessionId);
      break;
    case 'search':
      await sendSearchResults(message.query);
      break;
    case 'openSession':
      await openSessionMarkdown(provider, { session_id: message.sessionId });
      break;
    case 'configureLlm':
      await configureLlmProvider(context);
      await sendLlmState(context);
      break;
    case 'clearLlmCredentials':
      await clearLlmCredentials(context);
      await sendLlmState(context);
      break;
    case 'restartTopaDaemon':
      await restartProjectDaemonCommand(getProjectRoot());
      provider.refresh();
      break;
    case 'generateReport':
      await generateDashboardReport(context, message.sessionId);
      break;
    case 'saveReport':
      await saveDashboardReport(message.reportId);
      break;
    default:
      break;
  }
}

async function sendDashboardData(context, preferredSessionId = '') {
  if (!dashboardPanel) {
    return;
  }

  const root = getProjectRoot();
  const data = root
    ? readDashboardData(root)
    : { projectRoot: '', latestMarkdownPath: '', activeSessions: [], sessions: [] };
  dashboardPanel.webview.postMessage({
    type: 'dashboardData',
    data,
    llm: await getLlmState(context)
  });

  const shouldAutoSelect = preferredSessionId !== null;
  const sessionId = pendingDashboardSessionId
    || preferredSessionId
    || (shouldAutoSelect && data.sessions[0] && data.sessions[0].session_id);
  pendingDashboardSessionId = '';
  if (sessionId) {
    await sendSessionDetail(sessionId);
  }
}

async function sendSessionDetail(sessionId) {
  if (!dashboardPanel || !sessionId) {
    return;
  }
  const root = getProjectRoot();
  if (!root) {
    postDashboardError('Open a workspace folder to view Tarae history.');
    return;
  }

  const detail = getSessionDetail(root, sessionId);
  if (!detail) {
    postDashboardError(`Tarae session not found: ${sessionId}`);
    return;
  }
  dashboardPanel.webview.postMessage({ type: 'sessionDetail', detail });
}

async function sendSearchResults(query) {
  if (!dashboardPanel) {
    return;
  }
  const root = getProjectRoot();
  if (!root) {
    dashboardPanel.webview.postMessage({ type: 'searchResults', hits: [] });
    return;
  }
  dashboardPanel.webview.postMessage({
    type: 'searchResults',
    hits: searchHistory(root, query || '').slice(0, 200)
  });
}

async function sendLlmState(context) {
  if (!dashboardPanel) {
    return;
  }
  dashboardPanel.webview.postMessage({
    type: 'llmState',
    llm: await getLlmState(context)
  });
}

async function generateDashboardReport(context, sessionId) {
  if (!dashboardPanel) {
    return;
  }
  const root = getProjectRoot();
  if (!root) {
    postDashboardError('Open a workspace folder to generate a Tarae report.');
    return;
  }

  try {
    const reportContext = buildReportContext(root, sessionId);
    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Generating Tarae session report',
      cancellable: false
    }, () => generateSessionReport(context, reportContext));
    const reportId = createReportId(sessionId);
    const cachedReport = {
      ...result,
      context: reportContext
    };
    reportCache.set(reportId, cachedReport);

    let savedPath = '';
    if (vscode.workspace.getConfiguration().get('tarae.reports.autoSave', false)) {
      savedPath = saveReport(root, cachedReport);
    }

    dashboardPanel.webview.postMessage({
      type: 'reportGenerated',
      reportId,
      markdown: result.markdown,
      savedPath
    });
  } catch (error) {
    await handleReportError(context, error);
  }
}

async function saveDashboardReport(reportId) {
  if (!dashboardPanel) {
    return;
  }
  const root = getProjectRoot();
  const report = reportCache.get(reportId);
  if (!root || !report) {
    postDashboardError('No generated report is available to save.');
    return;
  }
  const reportPath = saveReport(root, report);
  dashboardPanel.webview.postMessage({ type: 'reportSaved', path: reportPath });
}

async function openLatestSession(provider) {
  const latestPath = provider.latestMarkdownPath();
  if (!latestPath) {
    vscode.window.showInformationMessage('No Tarae latest.md file found in this workspace.');
    return;
  }
  await openReadonlyMarkdown(latestPath);
}

async function listSessions(provider) {
  const picked = await pickSession(provider.sessions());
  if (picked) {
    await openSessionMarkdown(provider, picked.entry);
  }
}

async function searchHistoryCommand(provider) {
  const query = await vscode.window.showInputBox({
    title: 'Search Tarae History',
    prompt: 'Search JSONL events. Filters: type:checkpoint file:src agent:codex link:codex-main tag:#release after:2026-05-01 before:2026-05-28.',
    ignoreFocusOut: true
  });
  if (!query) {
    return;
  }

  const root = getProjectRoot();
  const hits = root ? searchHistory(root, query) : [];
  if (hits.length === 0) {
    vscode.window.showInformationMessage(`No Tarae history matches "${query}".`);
    return;
  }

  const picked = await vscode.window.showQuickPick(
    hits.map((hit) => ({
      label: hit.label,
      description: hit.description,
      detail: hit.detail,
      entry: provider.sessions().find((session) => session.session_id === hit.session_id) || hit.entry
    })),
    {
      title: 'Tarae: Search History',
      placeHolder: 'Open a matching session Markdown file'
    }
  );
  if (picked) {
    await openSessionMarkdown(provider, picked.entry);
  }
}

async function generateSessionReportCommand(context, provider, item) {
  const root = getProjectRoot();
  if (!root) {
    vscode.window.showInformationMessage('Open a workspace folder to generate a Tarae report.');
    return;
  }

  const entry = item && item.entry
    ? item.entry
    : item && item.session_id
      ? item
      : await pickSessionEntry(provider);
  if (!entry) {
    return;
  }

  const reportContext = buildReportContext(root, entry.session_id);
  const scope = reportContext.scope;
  const confirmed = await vscode.window.showInformationMessage(
    `Generate report for ${entry.objective || entry.session_id}?`,
    {
      modal: true,
      detail: [
        `Includes ${scope.event_count} events, ${scope.file_count} file records, ${scope.issue_count} issues, and rendered session Markdown.`,
        'Excludes API keys, raw project file contents, and full raw git diffs.'
      ].join('\n')
    },
    'Generate Report'
  );
  if (confirmed !== 'Generate Report') {
    return;
  }

  try {
    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Generating Tarae session report',
      cancellable: false
    }, () => generateSessionReport(context, reportContext));
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: result.markdown
    });
    await vscode.window.showTextDocument(document, { preview: false });

    const shouldSave = await vscode.window.showInformationMessage(
      'Tarae report preview opened.',
      'Save Report'
    );
    if (shouldSave === 'Save Report') {
      const reportPath = saveReport(root, { ...result, context: reportContext });
      vscode.window.showInformationMessage(`Tarae report saved: ${reportPath}`);
    }
  } catch (error) {
    await handleReportError(context, error);
  }
}

async function openSessionMarkdown(provider, item) {
  const entry = item && item.entry
    ? item.entry
    : item && item.session_id
      ? item
      : null;
  if (!entry || !entry.session_id) {
    const picked = await pickSession(provider.sessions());
    if (!picked) {
      return;
    }
    await openSessionMarkdown(provider, picked.entry);
    return;
  }

  const root = getProjectRoot();
  const session = root
    ? readHistory(root).sessions.find((candidate) => candidate.session_id === entry.session_id)
    : entry;
  const markdownPath = session && session.markdownPath;
  if (!markdownPath || !fs.existsSync(markdownPath)) {
    vscode.window.showErrorMessage(`Tarae session Markdown not found for ${entry.session_id}.`);
    return;
  }
  await openReadonlyMarkdown(markdownPath);
}

async function pickSession(sessions) {
  if (!sessions.length) {
    vscode.window.showInformationMessage('No Tarae sessions found in this workspace.');
    return null;
  }
  return vscode.window.showQuickPick(
    sessions.map((entry) => ({
      label: entry.objective || entry.session_id,
      description: compactDescription(entry),
      detail: entry.last_summary || entry.session_id,
      entry
    })),
    {
      title: 'Tarae: List Sessions',
      placeHolder: 'Open a session Markdown file'
    }
  );
}

async function pickSessionEntry(provider) {
  const picked = await pickSession(provider.sessions());
  return picked ? picked.entry : null;
}

async function openReadonlyMarkdown(filePath) {
  const uri = encodeTaraeUri(filePath);
  const document = await vscode.workspace.openTextDocument(uri);
  const markdownDocument = document.languageId === 'markdown'
    ? document
    : await vscode.languages.setTextDocumentLanguage(document, 'markdown');
  await vscode.window.showTextDocument(markdownDocument, { preview: false });
}

async function handleReportError(context, error) {
  if (error instanceof MissingCredentialsError || error.code === 'missingCredentials') {
    const choice = await vscode.window.showWarningMessage(
      'Tarae LLM credentials are not configured.',
      'Configure LLM'
    );
    if (choice === 'Configure LLM') {
      await configureLlmProvider(context);
      await sendLlmState(context);
    }
    postDashboardError('Configure an OpenAI API key before generating a report.');
    return;
  }

  const message = error && error.message ? error.message : String(error);
  vscode.window.showErrorMessage(message);
  postDashboardError(message);
}

function postDashboardError(message) {
  if (!dashboardPanel) {
    return;
  }
  dashboardPanel.webview.postMessage({
    type: 'error',
    message
  });
}

function refreshDashboard(context) {
  if (!dashboardPanel) {
    return;
  }
  sendDashboardData(context, null).catch((error) => postDashboardError(error.message || String(error)));
}

function getProjectRoot() {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) {
    return null;
  }
  return folders[0].uri.fsPath;
}

function encodeTaraeUri(filePath) {
  const encodedPath = Buffer.from(filePath, 'utf8').toString('base64url');
  const basename = path.basename(filePath) || 'session.md';
  return vscode.Uri.parse(`${TARAE_SCHEME}:/${encodedPath}/${encodeURIComponent(basename)}`);
}

function decodeTaraeUri(uri) {
  const encodedPath = uri.path.split('/').filter(Boolean)[0];
  if (!encodedPath) {
    return '';
  }
  return Buffer.from(encodedPath, 'base64url').toString('utf8');
}

function getNonce() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}

function createReportId(sessionId) {
  return `${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

module.exports = {
  activate,
  deactivate
};
