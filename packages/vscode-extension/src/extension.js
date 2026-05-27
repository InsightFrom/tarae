const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const TARAE_SCHEME = 'tarae-session';

function activate(context) {
  const provider = new TaraeSessionsProvider();
  const contentProvider = new TaraeMarkdownProvider();

  context.subscriptions.push(
    provider,
    vscode.window.registerTreeDataProvider('tarae.sessions', provider),
    vscode.workspace.registerTextDocumentContentProvider(TARAE_SCHEME, contentProvider),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh()),
    vscode.commands.registerCommand('tarae.refreshSessions', () => provider.refresh()),
    vscode.commands.registerCommand('tarae.openLatestSession', () => openLatestSession(provider)),
    vscode.commands.registerCommand('tarae.listSessions', () => listSessions(provider)),
    vscode.commands.registerCommand('tarae.searchHistory', () => searchHistory(provider)),
    vscode.commands.registerCommand('tarae.openSessionMarkdown', (item) => openSessionMarkdown(provider, item))
  );
}

function deactivate() {}

class TaraeSessionsProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.watchers = [];
    this.resetWatchers();
  }

  refresh() {
    this.resetWatchers();
    this._onDidChangeTreeData.fire();
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
      watcher.onDidCreate(() => this._onDidChangeTreeData.fire());
      watcher.onDidChange(() => this._onDidChangeTreeData.fire());
      watcher.onDidDelete(() => this._onDidChangeTreeData.fire());
      this.watchers.push(watcher);
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

async function searchHistory(provider) {
  const query = await vscode.window.showInputBox({
    title: 'Search Tarae History',
    prompt: 'Search objectives, summaries, session Markdown, and JSONL events.',
    ignoreFocusOut: true
  });
  if (!query) {
    return;
  }

  const normalizedQuery = query.toLowerCase();
  const hits = [];
  for (const entry of provider.sessions()) {
    const searchable = searchableText(entry);
    const markdown = readOptional(entry.markdownPath);
    const jsonl = readOptional(entry.jsonlPath);
    const haystack = `${searchable}\n${markdown}\n${jsonl}`.toLowerCase();
    if (haystack.includes(normalizedQuery)) {
      hits.push({
        label: entry.objective || entry.session_id,
        description: compactDescription(entry),
        detail: firstMatchingLine(`${searchable}\n${markdown}\n${jsonl}`, normalizedQuery),
        entry
      });
    }
  }

  if (hits.length === 0) {
    vscode.window.showInformationMessage(`No Tarae history matches "${query}".`);
    return;
  }

  const picked = await vscode.window.showQuickPick(hits, {
    title: 'Tarae: Search History',
    placeHolder: 'Open a matching session'
  });
  if (picked) {
    await openSessionMarkdown(provider, picked.entry);
  }
}

async function openSessionMarkdown(provider, item) {
  const entry = item && item.entry ? item.entry : item;
  if (!entry || !entry.session_id) {
    const picked = await pickSession(provider.sessions());
    if (!picked) {
      return;
    }
    await openSessionMarkdown(provider, picked.entry);
    return;
  }

  if (!entry.markdownPath || !fs.existsSync(entry.markdownPath)) {
    vscode.window.showErrorMessage(`Tarae session Markdown not found for ${entry.session_id}.`);
    return;
  }
  await openReadonlyMarkdown(entry.markdownPath);
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

async function openReadonlyMarkdown(filePath) {
  const uri = encodeTaraeUri(filePath);
  const document = await vscode.workspace.openTextDocument(uri);
  const markdownDocument = document.languageId === 'markdown'
    ? document
    : await vscode.languages.setTextDocumentLanguage(document, 'markdown');
  await vscode.window.showTextDocument(markdownDocument, { preview: false });
}

function readHistory(projectRoot) {
  const topaDir = path.join(projectRoot, '.tarae', 'topa');
  const sessionsDir = path.join(topaDir, 'sessions');
  const latestMarkdownPath = existingFile(path.join(topaDir, 'latest.md'));
  const sessionsById = new Map();

  for (const entry of readIndex(path.join(topaDir, 'session_index.jsonl'))) {
    sessionsById.set(entry.session_id, normalizeSessionEntry(entry, sessionsDir));
  }

  if (fs.existsSync(sessionsDir)) {
    for (const name of fs.readdirSync(sessionsDir)) {
      if (!name.endsWith('.md')) {
        continue;
      }
      const sessionId = name.slice(0, -'.md'.length);
      if (!sessionsById.has(sessionId)) {
        sessionsById.set(sessionId, normalizeSessionEntry({ session_id: sessionId }, sessionsDir));
      }
    }
  }

  const sessions = Array.from(sessionsById.values())
    .filter((entry) => entry.session_id)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));

  return {
    latestMarkdownPath,
    sessions
  };
}

function readIndex(indexPath) {
  const entries = [];
  const text = readOptional(indexPath);
  if (!text) {
    return entries;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const entry = JSON.parse(trimmed);
      if (entry && entry.session_id) {
        entries.push(entry);
      }
    } catch {
      // Ignore partially written or invalid index lines.
    }
  }
  return entries;
}

function normalizeSessionEntry(entry, sessionsDir) {
  const sessionId = entry.session_id;
  return {
    schema_version: entry.schema_version || '',
    session_id: sessionId,
    objective: entry.objective || '',
    agent_name: entry.agent_name || '',
    status: entry.status || 'unknown',
    started_at: entry.started_at || '',
    ended_at: entry.ended_at || '',
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    updated_at: entry.updated_at || '',
    event_count: Number(entry.event_count || 0),
    last_summary: entry.last_summary || '',
    markdownPath: path.join(sessionsDir, `${sessionId}.md`),
    jsonlPath: path.join(sessionsDir, `${sessionId}.jsonl`)
  };
}

function getProjectRoot() {
  const folders = vscode.workspace.workspaceFolders || [];
  if (folders.length === 0) {
    return null;
  }
  return folders[0].uri.fsPath;
}

function existingFile(filePath) {
  return fs.existsSync(filePath) ? filePath : null;
}

function readOptional(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return '';
  }
  return fs.readFileSync(filePath, 'utf8');
}

function compactDescription(entry) {
  const parts = [];
  if (entry.status) {
    parts.push(entry.status);
  }
  if (entry.updated_at) {
    parts.push(formatTimestamp(entry.updated_at));
  }
  if (entry.event_count) {
    parts.push(`${entry.event_count} events`);
  }
  return parts.join(' - ');
}

function sessionTooltip(entry) {
  return [
    entry.objective,
    `Session: ${entry.session_id}`,
    entry.agent_name ? `Agent: ${entry.agent_name}` : '',
    entry.status ? `Status: ${entry.status}` : '',
    entry.updated_at ? `Updated: ${entry.updated_at}` : '',
    entry.last_summary ? `Last summary: ${entry.last_summary}` : ''
  ].filter(Boolean).join('\n');
}

function searchableText(entry) {
  return [
    entry.session_id,
    entry.objective,
    entry.agent_name,
    entry.status,
    entry.last_summary,
    ...entry.tags
  ].filter(Boolean).join('\n');
}

function firstMatchingLine(text, normalizedQuery) {
  for (const line of text.split(/\r?\n/)) {
    if (line.toLowerCase().includes(normalizedQuery)) {
      return line.trim().slice(0, 240);
    }
  }
  return '';
}

function formatTimestamp(value) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }
  return new Date(timestamp).toLocaleString();
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

module.exports = {
  activate,
  deactivate
};
