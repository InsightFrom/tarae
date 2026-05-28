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
    prompt: 'Search JSONL events. Filters: type:checkpoint file:src agent:codex tag:#release after:2026-05-01 before:2026-05-28.',
    ignoreFocusOut: true
  });
  if (!query) {
    return;
  }

  const criteria = parseSearchQuery(query);
  const hits = [];
  for (const entry of provider.sessions()) {
    for (const event of readSessionEvents(entry)) {
      const match = matchSearchEvent(entry, event, criteria);
      if (!match.ok) {
        continue;
      }
      hits.push({
        label: eventQuickPickLabel(event),
        description: entry.objective || entry.session_id,
        detail: match.detail,
        entry,
        event
      });
    }
  }

  if (hits.length === 0) {
    vscode.window.showInformationMessage(`No Tarae history matches "${query}".`);
    return;
  }

  hits.sort((a, b) => eventSortTimestamp(b.event) - eventSortTimestamp(a.event));
  const picked = await vscode.window.showQuickPick(hits, {
    title: 'Tarae: Search History',
    placeHolder: 'Open a matching session Markdown file'
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

function readSessionEvents(entry) {
  const events = [];
  const text = readOptional(entry.jsonlPath);
  if (!text) {
    return events;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const event = JSON.parse(trimmed);
      if (event && event.event_id) {
        events.push(event);
      }
    } catch {
      // Ignore partially written or invalid JSONL lines.
    }
  }

  return events;
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

function parseSearchQuery(input) {
  const criteria = {
    terms: [],
    eventTypes: [],
    filePaths: [],
    agents: [],
    tags: [],
    sessions: [],
    statuses: [],
    after: null,
    before: null
  };

  for (const token of tokenizeSearchInput(input)) {
    const separator = token.indexOf(':');
    if (separator <= 0) {
      criteria.terms.push(token.toLowerCase());
      continue;
    }

    const key = token.slice(0, separator).toLowerCase();
    const value = token.slice(separator + 1);
    if (!value) {
      continue;
    }

    switch (key) {
      case 'type':
      case 'event':
      case 'event_type':
        criteria.eventTypes.push(value.toLowerCase());
        break;
      case 'file':
      case 'path':
        criteria.filePaths.push(value.toLowerCase());
        break;
      case 'agent':
      case 'actor':
        criteria.agents.push(value.toLowerCase());
        break;
      case 'tag':
        criteria.tags.push(value.toLowerCase());
        break;
      case 'session':
      case 'session_id':
        criteria.sessions.push(value.toLowerCase());
        break;
      case 'status':
        criteria.statuses.push(value.toLowerCase());
        break;
      case 'after':
      case 'since':
        criteria.after = parseDateFilter(value);
        break;
      case 'before':
      case 'until':
        criteria.before = parseDateFilter(value, true);
        break;
      default:
        criteria.terms.push(token.toLowerCase());
        break;
    }
  }

  return criteria;
}

function tokenizeSearchInput(input) {
  const tokens = [];
  const regex = /"([^"]+)"|'([^']+)'|(\S+)/g;
  let match;
  while ((match = regex.exec(input)) !== null) {
    tokens.push(match[1] || match[2] || match[3]);
  }
  return tokens;
}

function parseDateFilter(value, endOfDay = false) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return timestamp + 24 * 60 * 60 * 1000 - 1;
  }
  return timestamp;
}

function matchSearchEvent(entry, event, criteria) {
  const eventType = String(event.event_type || '').toLowerCase();
  if (criteria.eventTypes.length && !criteria.eventTypes.includes(eventType)) {
    return { ok: false };
  }

  const sessionId = String(event.session_id || entry.session_id || '').toLowerCase();
  if (criteria.sessions.length && !criteria.sessions.some((session) => sessionId.includes(session))) {
    return { ok: false };
  }

  const status = String(entry.status || '').toLowerCase();
  if (criteria.statuses.length && !criteria.statuses.includes(status)) {
    return { ok: false };
  }

  const timestamp = eventSortTimestamp(event);
  if (criteria.after && timestamp < criteria.after) {
    return { ok: false };
  }
  if (criteria.before && timestamp > criteria.before) {
    return { ok: false };
  }

  const files = eventFileChanges(event);
  if (criteria.filePaths.length && !criteria.filePaths.every((needle) => (
    files.some((file) => String(file.path || '').toLowerCase().includes(needle))
  ))) {
    return { ok: false };
  }

  const agents = [
    event.actor && event.actor.type,
    event.actor && event.actor.agent_name,
    entry.agent_name
  ].filter(Boolean).map((value) => String(value).toLowerCase());
  if (criteria.agents.length && !criteria.agents.some((needle) => (
    agents.some((agent) => agent.includes(needle))
  ))) {
    return { ok: false };
  }

  const tags = eventTags(entry, event).map((tag) => tag.toLowerCase());
  if (criteria.tags.length && !criteria.tags.every((needle) => (
    tags.some((tag) => tag.includes(needle))
  ))) {
    return { ok: false };
  }

  const haystack = eventSearchText(entry, event);
  const normalized = haystack.toLowerCase();
  if (criteria.terms.length && !criteria.terms.every((term) => normalized.includes(term))) {
    return { ok: false };
  }

  return {
    ok: true,
    detail: eventSearchDetail(entry, event, criteria, haystack)
  };
}

function eventQuickPickLabel(event) {
  const eventType = event.event_type || 'event';
  const timestamp = event.timestamp ? formatTimestamp(event.timestamp) : '';
  return timestamp ? `${eventType} - ${timestamp}` : eventType;
}

function eventSearchDetail(entry, event, criteria, haystack) {
  const files = eventFileChanges(event);
  const fileSummary = files.slice(0, 3).map(formatFileChange).join(', ');
  const firstTerm = criteria.terms[0] || criteria.filePaths[0] || criteria.agents[0] || criteria.tags[0] || '';
  const snippet = firstTerm ? firstMatchingLine(haystack, firstTerm) : '';
  return [
    eventSummary(event) || entry.last_summary,
    fileSummary ? `Files: ${fileSummary}${files.length > 3 ? `, +${files.length - 3} more` : ''}` : '',
    snippet
  ].filter(Boolean).join(' | ');
}

function eventSearchText(entry, event) {
  const payload = event.payload || {};
  const error = payload.error_context || {};
  const gitRef = payload.git_ref || {};
  const files = eventFileChanges(event);
  return [
    searchableText(entry),
    event.event_id,
    event.event_type,
    event.timestamp,
    event.session_id,
    event.actor && event.actor.type,
    event.actor && event.actor.agent_name,
    payload.objective,
    payload.summary,
    ...asArray(payload.tags),
    gitRef.branch,
    gitRef.commit_hash,
    gitRef.commit_message,
    error.error_message,
    error.runtime_version,
    ...asArray(error.log_tail),
    ...files.flatMap((file) => [
      file.path,
      file.action,
      `${file.path} +${file.lines_added || 0} -${file.lines_removed || 0}`
    ])
  ].filter(Boolean).join('\n');
}

function eventSummary(event) {
  const payload = event.payload || {};
  if (payload.summary) {
    return payload.summary;
  }
  if (payload.objective) {
    return payload.objective;
  }
  if (payload.error_context && payload.error_context.error_message) {
    return payload.error_context.error_message;
  }
  return '';
}

function eventTags(entry, event) {
  const payload = event.payload || {};
  return [
    ...asArray(entry.tags),
    ...asArray(payload.tags)
  ].filter(Boolean);
}

function eventFileChanges(event) {
  const payload = event.payload || {};
  return asArray(payload.file_changes).filter((file) => file && typeof file === 'object');
}

function formatFileChange(file) {
  const pathLabel = file.path || '(unknown)';
  const action = file.action || 'modified';
  return `${action} ${pathLabel} (+${file.lines_added || 0} -${file.lines_removed || 0})`;
}

function eventSortTimestamp(event) {
  const timestamp = Date.parse(event.timestamp || '');
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
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
