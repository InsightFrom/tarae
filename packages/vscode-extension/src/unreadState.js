const crypto = require('crypto');

const READ_SESSIONS_KEY_PREFIX = 'tarae.readSessions.v1';

function readStateKey(projectRoot) {
  const digest = crypto.createHash('sha256').update(projectRoot).digest('hex');
  return `${READ_SESSIONS_KEY_PREFIX}.${digest}`;
}

function readSignature(entry) {
  return `${entry.updated_at || ''}|${Number(entry.event_count || 0)}`;
}

function createReadBaseline(sessions) {
  return Object.fromEntries(
    sessions
      .filter((entry) => entry.session_id)
      .map((entry) => [entry.session_id, readSignature(entry)])
  );
}

function isUnreadSession(entry, readState) {
  return Boolean(entry && entry.session_id && readState[entry.session_id] !== readSignature(entry));
}

module.exports = {
  createReadBaseline,
  isUnreadSession,
  readSignature,
  readStateKey
};
