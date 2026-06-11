const fs = require('fs');
const path = require('path');

function readHistory(projectRoot) {
  const topaDir = path.join(projectRoot, '.tarae', 'topa');
  const sessionsDir = path.join(topaDir, 'sessions');
  const latestMarkdownPath = existingFile(path.join(topaDir, 'latest.md'));
  const activeSessions = readActiveSessions(path.join(topaDir, 'active_sessions.json'));
  const sessionsById = new Map();

  for (const entry of readIndex(path.join(topaDir, 'session_index.jsonl'))) {
    sessionsById.set(entry.session_id, normalizeSessionEntry(entry, sessionsDir));
  }

  if (fs.existsSync(sessionsDir)) {
    let sessionFiles = [];
    try {
      sessionFiles = fs.readdirSync(sessionsDir);
    } catch {
      sessionFiles = [];
    }
    for (const name of sessionFiles) {
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
    topaDir,
    latestMarkdownPath,
    activeSessions,
    sessions
  };
}

function readDashboardData(projectRoot) {
  const history = readHistory(projectRoot);
  return {
    projectRoot,
    latestMarkdownPath: history.latestMarkdownPath,
    activeSessions: history.activeSessions,
    sessions: history.sessions.map(publicSessionEntry)
  };
}

function getSessionDetail(projectRoot, sessionId) {
  const history = readHistory(projectRoot);
  const entry = history.sessions.find((session) => session.session_id === sessionId);
  if (!entry) {
    return null;
  }

  const events = readSessionEvents(entry);
  const markdown = readOptional(entry.markdownPath);
  const fileChanges = aggregateFileChanges(events);
  const issues = events.filter((event) => event.event_type === 'issue_report');

  return {
    entry: publicSessionEntry(entry),
    events: events.map(publicEvent),
    fileChanges,
    issues: issues.map(publicEvent),
    reportScope: buildReportScope(entry, events, markdown),
    markdownPath: entry.markdownPath
  };
}

function searchHistory(projectRoot, query) {
  const criteria = parseSearchQuery(query || '');
  const hits = [];
  for (const entry of readHistory(projectRoot).sessions) {
    for (const event of readSessionEvents(entry)) {
      const match = matchSearchEvent(entry, event, criteria);
      if (!match.ok) {
        continue;
      }
      hits.push({
        label: eventQuickPickLabel(event),
        description: entry.objective || entry.session_id,
        detail: match.detail,
        session_id: entry.session_id,
        event: publicEvent(event),
        entry: publicSessionEntry(entry)
      });
    }
  }

  hits.sort((a, b) => eventSortTimestamp(b.event) - eventSortTimestamp(a.event));
  return hits;
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

function readActiveSessions(activePath) {
  const text = readOptional(activePath);
  if (!text) {
    return [];
  }

  try {
    const document = JSON.parse(text);
    return Array.isArray(document.sessions)
      ? document.sessions.map((record) => ({
        active_key: record.active_key || '',
        session_id: record.session_id || '',
        objective: record.objective || '',
        agent_name: record.agent_name || '',
        link_id: record.link_id || '',
        updated_at: record.updated_at || ''
      })).filter((record) => record.session_id)
      : [];
  } catch {
    return [];
  }
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
    link_id: entry.link_id || '',
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

function publicSessionEntry(entry) {
  return {
    schema_version: entry.schema_version || '',
    session_id: entry.session_id || '',
    objective: entry.objective || '',
    agent_name: entry.agent_name || '',
    link_id: entry.link_id || '',
    status: entry.status || 'unknown',
    started_at: entry.started_at || '',
    ended_at: entry.ended_at || '',
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    updated_at: entry.updated_at || '',
    event_count: Number(entry.event_count || 0),
    last_summary: entry.last_summary || '',
    markdownPath: entry.markdownPath || '',
    jsonlPath: entry.jsonlPath || ''
  };
}

function publicEvent(event) {
  const payload = event.payload || {};
  return {
    schema_version: event.schema_version || '',
    event_id: event.event_id || '',
    event_type: event.event_type || '',
    session_id: event.session_id || '',
    timestamp: event.timestamp || '',
    actor: event.actor || {},
    summary: eventSummary(event),
    file_changes: eventFileChanges(event),
    tags: asArray(payload.tags),
    git_ref: payload.git_ref || {},
    error_context: payload.error_context || null,
    attribution: payload.attribution || null,
    payload
  };
}

function aggregateFileChanges(events) {
  const files = new Map();
  for (const event of events) {
    for (const file of eventFileChanges(event)) {
      const key = file.path || '(unknown)';
      const current = files.get(key) || {
        path: key,
        action: file.action || 'modified',
        lines_added: 0,
        lines_removed: 0,
        events: []
      };
      current.action = mergeAction(current.action, file.action || 'modified');
      current.lines_added += Number(file.lines_added || 0);
      current.lines_removed += Number(file.lines_removed || 0);
      current.events.push({
        event_id: event.event_id || '',
        event_type: event.event_type || '',
        timestamp: event.timestamp || '',
        summary: eventSummary(event)
      });
      files.set(key, current);
    }
  }
  return Array.from(files.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function mergeAction(existing, next) {
  if (existing === 'deleted' || next === 'deleted') {
    return 'deleted';
  }
  if (existing === 'renamed' || next === 'renamed') {
    return 'renamed';
  }
  if (existing === 'created' || next === 'created') {
    return 'created';
  }
  return 'modified';
}

function buildReportScope(entry, events, markdown) {
  const files = aggregateFileChanges(events);
  const issues = events.filter((event) => event.event_type === 'issue_report');
  return {
    session_id: entry.session_id,
    objective: entry.objective || '',
    agent_name: entry.agent_name || '',
    link_id: entry.link_id || '',
    status: entry.status || '',
    event_count: events.length,
    file_count: files.length,
    issue_count: issues.length,
    markdown_chars: markdown.length,
    includes: [
      'session metadata',
      'JSONL event timeline',
      'checkpoint and issue summaries',
      'file change metadata',
      'rendered session Markdown'
    ],
    excludes: [
      'API keys and VS Code secrets',
      'raw project file contents',
      'full raw git diffs'
    ],
    ignore_policy: '.taraeignore and watcher ignore rules are respected because reports use recorded Tarae history, not raw workspace file reads.'
  };
}

function existingFile(filePath) {
  try {
    return fs.existsSync(filePath) ? filePath : null;
  } catch {
    return null;
  }
}

function readOptional(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return '';
    }
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
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
    entry.link_id ? `Link: ${entry.link_id}` : '',
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
    entry.link_id,
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
    links: [],
    tags: [],
    sessions: [],
    statuses: [],
    after: null,
    before: null
  };

  for (const token of tokenizeSearchInput(input || '')) {
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
      case 'link':
      case 'link_id':
        criteria.links.push(value.toLowerCase());
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

  const links = [
    event.actor && event.actor.link_id,
    entry.link_id
  ].filter(Boolean).map((value) => String(value).toLowerCase());
  if (criteria.links.length && !criteria.links.some((needle) => (
    links.some((link) => link.includes(needle))
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
  const firstTerm = criteria.terms[0] || criteria.filePaths[0] || criteria.agents[0] || criteria.links[0] || criteria.tags[0] || '';
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
  const attribution = payload.attribution || {};
  const files = eventFileChanges(event);
  return [
    searchableText(entry),
    event.event_id,
    event.event_type,
    event.timestamp,
    event.session_id,
    event.actor && event.actor.type,
    event.actor && event.actor.agent_name,
    event.actor && event.actor.link_id,
    payload.objective,
    payload.summary,
    ...asArray(payload.tags),
    gitRef.branch,
    gitRef.commit_hash,
    gitRef.commit_message,
    error.error_message,
    error.runtime_version,
    ...asArray(error.log_tail),
    attribution.status,
    attribution.reason,
    ...asArray(attribution.candidate_session_ids),
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

module.exports = {
  aggregateFileChanges,
  buildReportScope,
  compactDescription,
  eventFileChanges,
  eventQuickPickLabel,
  eventSortTimestamp,
  formatFileChange,
  formatTimestamp,
  getSessionDetail,
  readDashboardData,
  readHistory,
  readOptional,
  readSessionEvents,
  searchHistory,
  sessionTooltip
};
