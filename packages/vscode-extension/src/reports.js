const fs = require('fs');
const path = require('path');

const {
  aggregateFileChanges,
  buildReportScope,
  readHistory,
  readOptional,
  readSessionEvents
} = require('./history');

const MAX_MARKDOWN_INPUT_CHARS = 40000;
const MAX_EVENTS_IN_PROMPT = 120;
const REPORT_SCHEMA_VERSION = 'tarae-report-v1';

function buildReportContext(projectRoot, sessionId) {
  const history = readHistory(projectRoot);
  const entry = history.sessions.find((session) => session.session_id === sessionId);
  if (!entry) {
    throw new Error(`Tarae session not found: ${sessionId}`);
  }

  const events = readSessionEvents(entry);
  const markdown = readOptional(entry.markdownPath);
  const fileChanges = aggregateFileChanges(events);
  const issues = events.filter((event) => event.event_type === 'issue_report');
  const scope = buildReportScope(entry, events, markdown);

  return {
    projectRoot,
    entry,
    events,
    fileChanges,
    issues,
    markdown,
    scope
  };
}

function buildReportPrompt(context) {
  const eventTimeline = context.events.slice(-MAX_EVENTS_IN_PROMPT).map((event) => ({
    timestamp: event.timestamp,
    event_type: event.event_type,
    actor: {
      type: event.actor && event.actor.type,
      agent_name: event.actor && event.actor.agent_name,
      link_id: event.actor && event.actor.link_id
    },
    summary: eventSummary(event),
    files: eventFileChanges(event),
    attribution: event.payload && event.payload.attribution,
    error: event.payload && event.payload.error_context
  }));

  const reportInput = {
    session: {
      session_id: context.entry.session_id,
      objective: context.entry.objective,
      agent_name: context.entry.agent_name,
      link_id: context.entry.link_id,
      status: context.entry.status,
      started_at: context.entry.started_at,
      ended_at: context.entry.ended_at,
      updated_at: context.entry.updated_at,
      tags: context.entry.tags,
      event_count: context.entry.event_count,
      last_summary: context.entry.last_summary
    },
    report_scope: context.scope,
    file_changes: context.fileChanges,
    issues: context.issues.map((event) => ({
      timestamp: event.timestamp,
      summary: eventSummary(event),
      error_context: event.payload && event.payload.error_context
    })),
    event_timeline: eventTimeline,
    rendered_markdown_excerpt: truncateText(context.markdown, MAX_MARKDOWN_INPUT_CHARS)
  };

  return [
    'You are generating a concise engineering report for a local Tarae AI coding session.',
    'Write in the same language as the session summaries when clear; otherwise write in Korean.',
    'Use Markdown. Do not invent facts that are not present in the input.',
    'Include these sections: Summary, Work Completed, Files Changed, Issues And Verification, Risks Or Follow-ups.',
    'The input contains recorded Tarae history only. It does not include raw source file contents or API keys.',
    '',
    JSON.stringify(reportInput, null, 2)
  ].join('\n');
}

function formatReportMarkdown({ markdown, provider, model, generatedAt, context }) {
  const frontmatter = [
    '---',
    `schema_version: ${REPORT_SCHEMA_VERSION}`,
    `provider: ${yamlScalar(provider)}`,
    `model: ${yamlScalar(model)}`,
    `generated_at: ${yamlScalar(generatedAt)}`,
    `session_id: ${yamlScalar(context.entry.session_id)}`,
    `agent_name: ${yamlScalar(context.entry.agent_name || '')}`,
    `link_id: ${yamlScalar(context.entry.link_id || '')}`,
    `status: ${yamlScalar(context.entry.status || '')}`,
    '---',
    ''
  ].join('\n');

  return `${frontmatter}${String(markdown || '').trim()}\n`;
}

function saveReport(projectRoot, report) {
  if (!report || !report.context || !report.markdown) {
    throw new Error('No generated report is available to save.');
  }

  const sessionId = report.context.entry.session_id;
  const reportsDir = path.join(projectRoot, '.tarae', 'topa', 'reports', sessionId);
  fs.mkdirSync(reportsDir, { recursive: true });

  const timestamp = safeTimestamp(report.generatedAt || new Date().toISOString());
  const reportPath = path.join(reportsDir, `${timestamp}.md`);
  fs.writeFileSync(reportPath, report.markdown, 'utf8');
  return reportPath;
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

function eventFileChanges(event) {
  const payload = event.payload || {};
  return Array.isArray(payload.file_changes) ? payload.file_changes : [];
}

function truncateText(text, maxChars) {
  const value = String(text || '');
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n\n[Truncated ${value.length - maxChars} characters]`;
}

function safeTimestamp(value) {
  return String(value || new Date().toISOString()).replace(/[:.]/g, '-');
}

function yamlScalar(value) {
  return JSON.stringify(String(value || ''));
}

module.exports = {
  buildReportContext,
  buildReportPrompt,
  formatReportMarkdown,
  saveReport
};
