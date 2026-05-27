use anyhow::{Context, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use crate::mcp::schema::{
    ActorType, EventPayload, EventType, FileAction, FileChange, GitRef, TopaEvent,
};

const EVENT_SCHEMA_VERSION: &str = "topa-event-v1";
const SESSION_DOC_SCHEMA_VERSION: &str = "topa-session-v1";
const INDEX_SCHEMA_VERSION: &str = "topa-session-index-v1";

#[derive(Debug, Clone)]
pub struct HistoryStore {
    project_root: PathBuf,
    topa_dir: PathBuf,
    sessions_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionIndexEntry {
    pub schema_version: String,
    pub session_id: String,
    pub objective: Option<String>,
    pub agent_name: Option<String>,
    pub status: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub tags: Vec<String>,
    pub project_root: String,
    pub updated_at: String,
    pub event_count: usize,
    pub last_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveSessionRecord {
    pub session_id: String,
    pub objective: Option<String>,
    pub agent_name: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct SearchHit {
    pub session_id: String,
    pub event_type: String,
    pub timestamp: String,
    pub summary: Option<String>,
    pub files: Vec<String>,
}

impl HistoryStore {
    pub fn open(project_root: impl AsRef<Path>) -> Result<Self> {
        let project_root = project_root.as_ref().canonicalize().with_context(|| {
            format!(
                "failed to canonicalize project root {}",
                project_root.as_ref().display()
            )
        })?;
        let topa_dir = project_root.join(".tarae").join("topa");
        let sessions_dir = topa_dir.join("sessions");
        fs::create_dir_all(&sessions_dir)
            .with_context(|| format!("failed to create {}", sessions_dir.display()))?;

        Ok(Self {
            project_root,
            topa_dir,
            sessions_dir,
        })
    }

    pub fn topa_dir(&self) -> &Path {
        &self.topa_dir
    }

    pub fn append_event(&self, event: &TopaEvent) -> Result<String> {
        if event.schema_version != EVENT_SCHEMA_VERSION {
            anyhow::bail!("unsupported event schema: {}", event.schema_version);
        }

        let session_key = self.session_key(event);
        let jsonl_path = self.session_jsonl_path(&session_key);
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&jsonl_path)
            .with_context(|| format!("failed to open {}", jsonl_path.display()))?;
        serde_json::to_writer(&mut file, event)?;
        writeln!(file)?;

        let events = self.read_events(&session_key)?;
        let markdown = self.render_session_markdown(&session_key, &events);
        let markdown_path = self.session_markdown_path(&session_key);
        fs::write(&markdown_path, markdown)
            .with_context(|| format!("failed to write {}", markdown_path.display()))?;
        fs::copy(&markdown_path, self.topa_dir.join("latest.md")).with_context(|| {
            format!(
                "failed to update {}",
                self.topa_dir.join("latest.md").display()
            )
        })?;

        let index_entry = self.build_index_entry(&session_key, &events);
        self.append_index_entry(&index_entry)?;

        Ok(format!(
            "Event {} recorded in {}",
            event.event_id,
            markdown_path.display()
        ))
    }

    pub fn set_active_session(
        &self,
        session_id: &str,
        objective: Option<&str>,
        agent_name: Option<&str>,
    ) -> Result<()> {
        let record = ActiveSessionRecord {
            session_id: session_id.to_string(),
            objective: objective.map(str::to_string),
            agent_name: agent_name.map(str::to_string),
            updated_at: Utc::now().to_rfc3339(),
        };
        fs::write(
            self.topa_dir.join("active_session.json"),
            serde_json::to_string_pretty(&record)?,
        )?;
        Ok(())
    }

    pub fn clear_active_session(&self) -> Result<()> {
        let path = self.topa_dir.join("active_session.json");
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }

    pub fn get_active_session(&self) -> Result<Option<String>> {
        let path = self.topa_dir.join("active_session.json");
        if !path.exists() {
            return Ok(None);
        }
        let record: ActiveSessionRecord = serde_json::from_slice(&fs::read(path)?)?;
        Ok(Some(record.session_id))
    }

    pub fn list_sessions(
        &self,
        limit: usize,
        status: Option<&str>,
    ) -> Result<Vec<SessionIndexEntry>> {
        let mut latest_by_session = HashMap::<String, SessionIndexEntry>::new();
        let index_path = self.index_path();
        if !index_path.exists() {
            return Ok(Vec::new());
        }

        for line in read_lines(&index_path)? {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(entry) = serde_json::from_str::<SessionIndexEntry>(trimmed) {
                latest_by_session.insert(entry.session_id.clone(), entry);
            }
        }

        let mut entries: Vec<SessionIndexEntry> = latest_by_session.into_values().collect();
        if let Some(status) = status {
            entries.retain(|entry| entry.status == status);
        }
        entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        entries.truncate(limit.max(1));
        Ok(entries)
    }

    pub fn read_session_markdown(&self, session_id: &str) -> Result<String> {
        let path = self.session_markdown_path(session_id);
        fs::read_to_string(&path).with_context(|| format!("failed to read {}", path.display()))
    }

    pub fn read_session_jsonl(&self, session_id: &str) -> Result<String> {
        let path = self.session_jsonl_path(session_id);
        fs::read_to_string(&path).with_context(|| format!("failed to read {}", path.display()))
    }

    pub fn search_history(
        &self,
        query: Option<&str>,
        file_path: Option<&str>,
        event_type: Option<&str>,
        limit: usize,
    ) -> Result<Vec<SearchHit>> {
        let query = query.map(|q| q.to_ascii_lowercase());
        let file_path = file_path.map(|p| p.to_ascii_lowercase());
        let event_type = event_type.map(|t| t.to_ascii_lowercase());
        let mut hits = Vec::new();

        if !self.sessions_dir.exists() {
            return Ok(hits);
        }

        for entry in fs::read_dir(&self.sessions_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                continue;
            }
            let Some(session_id) = path.file_stem().and_then(|stem| stem.to_str()) else {
                continue;
            };
            for event in self.read_events(session_id)? {
                if let Some(expected_type) = &event_type {
                    if event_type_name(&event.event_type) != expected_type {
                        continue;
                    }
                }

                let files = event
                    .payload
                    .file_changes
                    .as_deref()
                    .unwrap_or_default()
                    .iter()
                    .map(|change| change.path.clone())
                    .collect::<Vec<_>>();

                if let Some(expected_path) = &file_path {
                    if !files
                        .iter()
                        .any(|path| path.to_ascii_lowercase().contains(expected_path))
                    {
                        continue;
                    }
                }

                if let Some(expected_query) = &query {
                    let mut haystack = String::new();
                    push_optional(&mut haystack, event.payload.summary.as_deref());
                    push_optional(&mut haystack, event.payload.objective.as_deref());
                    if let Some(error) = &event.payload.error_context {
                        push_optional(&mut haystack, Some(&error.error_message));
                        for line in &error.log_tail {
                            push_optional(&mut haystack, Some(line));
                        }
                    }
                    for file in &files {
                        push_optional(&mut haystack, Some(file));
                    }
                    if !haystack.to_ascii_lowercase().contains(expected_query) {
                        continue;
                    }
                }

                hits.push(SearchHit {
                    session_id: session_id.to_string(),
                    event_type: event_type_name(&event.event_type).to_string(),
                    timestamp: event.timestamp.to_rfc3339(),
                    summary: event_summary(&event.payload),
                    files,
                });

                if hits.len() >= limit.max(1) {
                    return Ok(hits);
                }
            }
        }

        Ok(hits)
    }

    fn session_key(&self, event: &TopaEvent) -> String {
        event
            .session_id
            .map(|id| id.to_string())
            .unwrap_or_else(|| format!("human-{}", event.timestamp.format("%Y-%m-%d")))
    }

    fn session_jsonl_path(&self, session_id: &str) -> PathBuf {
        self.sessions_dir.join(format!("{session_id}.jsonl"))
    }

    fn session_markdown_path(&self, session_id: &str) -> PathBuf {
        self.sessions_dir.join(format!("{session_id}.md"))
    }

    fn index_path(&self) -> PathBuf {
        self.topa_dir.join("session_index.jsonl")
    }

    fn read_events(&self, session_id: &str) -> Result<Vec<TopaEvent>> {
        let path = self.session_jsonl_path(session_id);
        if !path.exists() {
            return Ok(Vec::new());
        }

        let mut events = Vec::new();
        for line in read_lines(&path)? {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let event = serde_json::from_str::<TopaEvent>(trimmed)
                .with_context(|| format!("failed to parse event in {}", path.display()))?;
            events.push(event);
        }
        Ok(events)
    }

    fn append_index_entry(&self, entry: &SessionIndexEntry) -> Result<()> {
        let index_path = self.index_path();
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&index_path)
            .with_context(|| format!("failed to open {}", index_path.display()))?;
        serde_json::to_writer(&mut file, entry)?;
        writeln!(file)?;
        Ok(())
    }

    fn build_index_entry(&self, session_id: &str, events: &[TopaEvent]) -> SessionIndexEntry {
        let mut objective = None;
        let mut agent_name = None;
        let mut status = "active".to_string();
        let mut started_at = None;
        let mut ended_at = None;
        let mut tags = Vec::new();
        let mut last_summary = None;
        let mut updated_at = Utc::now().to_rfc3339();

        for event in events {
            updated_at = event.timestamp.to_rfc3339();
            if event.event_type == EventType::SessionStart {
                started_at = Some(event.timestamp.to_rfc3339());
                objective = event.payload.objective.clone();
                agent_name = event.actor.agent_name.clone();
                tags = event.payload.tags.clone();
            }
            if event.event_type == EventType::SessionEnd {
                status = "completed".to_string();
                ended_at = Some(event.timestamp.to_rfc3339());
            }
            if let Some(summary) = event_summary(&event.payload) {
                last_summary = Some(summary);
            }
        }

        SessionIndexEntry {
            schema_version: INDEX_SCHEMA_VERSION.to_string(),
            session_id: session_id.to_string(),
            objective,
            agent_name,
            status,
            started_at,
            ended_at,
            tags,
            project_root: self.project_root.display().to_string(),
            updated_at,
            event_count: events.len(),
            last_summary,
        }
    }

    fn render_session_markdown(&self, session_id: &str, events: &[TopaEvent]) -> String {
        let index = self.build_index_entry(session_id, events);
        let mut out = String::new();
        out.push_str("---\n");
        out.push_str(&format!(
            "schema_version: {}\n",
            yaml_string(SESSION_DOC_SCHEMA_VERSION)
        ));
        out.push_str(&format!("session_id: {}\n", yaml_string(&index.session_id)));
        out.push_str(&format!(
            "objective: {}\n",
            yaml_optional(index.objective.as_deref())
        ));
        out.push_str(&format!(
            "agent_name: {}\n",
            yaml_optional(index.agent_name.as_deref())
        ));
        out.push_str(&format!("status: {}\n", yaml_string(&index.status)));
        out.push_str(&format!(
            "started_at: {}\n",
            yaml_optional(index.started_at.as_deref())
        ));
        out.push_str(&format!(
            "ended_at: {}\n",
            yaml_optional(index.ended_at.as_deref())
        ));
        out.push_str(&format!("tags: {}\n", yaml_array(&index.tags)));
        out.push_str(&format!(
            "project_root: {}\n",
            yaml_string(&index.project_root)
        ));
        out.push_str("---\n\n");
        out.push_str(&format!("# Tarae Session {}\n\n", index.session_id));
        if let Some(objective) = &index.objective {
            out.push_str(&format!("Objective: {}\n\n", objective));
        }
        out.push_str("## Timeline\n\n");

        for event in events {
            out.push_str(&format!(
                "### {} {}\n\n",
                event.timestamp.to_rfc3339(),
                event_type_name(&event.event_type)
            ));
            out.push_str(&format!("Actor: {}\n\n", actor_label(event)));
            render_payload(&mut out, &event.payload);
        }

        out
    }
}

fn read_lines(path: &Path) -> Result<Vec<String>> {
    let file = fs::File::open(path)?;
    let reader = BufReader::new(file);
    reader
        .lines()
        .collect::<std::io::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn push_optional(target: &mut String, value: Option<&str>) {
    if let Some(value) = value {
        target.push_str(value);
        target.push('\n');
    }
}

fn event_summary(payload: &EventPayload) -> Option<String> {
    payload
        .summary
        .clone()
        .or_else(|| payload.objective.clone())
        .or_else(|| {
            payload
                .error_context
                .as_ref()
                .map(|error| error.error_message.clone())
        })
}

fn actor_label(event: &TopaEvent) -> String {
    match event.actor.actor_type {
        ActorType::AiAgent => event
            .actor
            .agent_name
            .as_deref()
            .map(|name| format!("ai_agent ({name})"))
            .unwrap_or_else(|| "ai_agent".to_string()),
        ActorType::Human => "human".to_string(),
    }
}

fn render_payload(out: &mut String, payload: &EventPayload) {
    if let Some(objective) = &payload.objective {
        out.push_str(&format!("Objective: {}\n\n", objective));
    }
    if let Some(summary) = &payload.summary {
        out.push_str(&format!("Summary: {}\n\n", summary));
    }
    if !payload.tags.is_empty() {
        out.push_str(&format!("Tags: {}\n\n", payload.tags.join(", ")));
    }
    if let Some(git_ref) = &payload.git_ref {
        render_git_ref(out, git_ref);
    }
    if let Some(file_changes) = &payload.file_changes {
        render_file_changes(out, file_changes);
    }
    if let Some(tokens) = payload.estimated_tokens {
        out.push_str(&format!("Estimated tokens: {}\n\n", tokens));
    }
    if let Some(error) = &payload.error_context {
        out.push_str(&format!("Error: {}\n\n", error.error_message));
        if let Some(runtime) = &error.runtime_version {
            out.push_str(&format!("Runtime: {}\n\n", runtime));
        }
        if !error.log_tail.is_empty() {
            out.push_str("Log tail:\n\n```text\n");
            for line in error.log_tail.iter().take(20) {
                out.push_str(line);
                out.push('\n');
            }
            out.push_str("```\n\n");
        }
    }
}

fn render_git_ref(out: &mut String, git_ref: &GitRef) {
    out.push_str(&format!(
        "Git: {} @ {}",
        git_ref.branch, git_ref.commit_hash
    ));
    if let Some(message) = &git_ref.commit_message {
        out.push_str(&format!(" ({message})"));
    }
    out.push_str("\n\n");
}

fn render_file_changes(out: &mut String, file_changes: &[FileChange]) {
    if file_changes.is_empty() {
        return;
    }
    out.push_str("Files:\n\n");
    for change in file_changes {
        out.push_str(&format!(
            "- {} `{}` (+{} -{})\n",
            file_action_name(&change.action),
            change.path,
            change.lines_added,
            change.lines_removed
        ));
    }
    out.push('\n');
}

fn event_type_name(event_type: &EventType) -> &'static str {
    match event_type {
        EventType::SessionStart => "session_start",
        EventType::Checkpoint => "checkpoint",
        EventType::AutoCheckpoint => "auto_checkpoint",
        EventType::SessionEnd => "session_end",
        EventType::IssueReport => "issue_report",
        EventType::HumanIntervention => "human_intervention",
    }
}

fn file_action_name(action: &FileAction) -> &'static str {
    match action {
        FileAction::Created => "created",
        FileAction::Modified => "modified",
        FileAction::Deleted => "deleted",
        FileAction::Renamed => "renamed",
    }
}

fn yaml_optional(value: Option<&str>) -> String {
    value.map(yaml_string).unwrap_or_else(|| "null".to_string())
}

fn yaml_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

fn yaml_array(values: &[String]) -> String {
    serde_json::to_string(values).unwrap_or_else(|_| "[]".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::schema::{Actor, ActorType, EventPayload};
    use tempfile::TempDir;
    use uuid::Uuid;

    fn make_event(session_id: Uuid, event_type: EventType, summary: &str) -> TopaEvent {
        let mut event = TopaEvent::new(
            event_type,
            Actor {
                actor_type: ActorType::AiAgent,
                agent_name: Some("codex".to_string()),
            },
            EventPayload {
                summary: Some(summary.to_string()),
                ..Default::default()
            },
        );
        event.session_id = Some(session_id);
        event
    }

    #[test]
    fn append_event_writes_jsonl_markdown_latest_and_index() {
        let dir = TempDir::new().unwrap();
        let store = HistoryStore::open(dir.path()).unwrap();
        let session_id = Uuid::new_v4();

        let mut start = make_event(session_id, EventType::SessionStart, "started");
        start.payload.objective = Some("test objective".to_string());
        store.append_event(&start).unwrap();
        store
            .append_event(&make_event(session_id, EventType::Checkpoint, "checkpoint"))
            .unwrap();

        let sid = session_id.to_string();
        assert!(store.session_jsonl_path(&sid).exists());
        assert!(store.session_markdown_path(&sid).exists());
        assert!(store.topa_dir().join("latest.md").exists());
        assert!(store.index_path().exists());

        let markdown = store.read_session_markdown(&sid).unwrap();
        assert!(markdown.contains("topa-session-v1"));
        assert!(markdown.contains("test objective"));
        assert!(markdown.contains("checkpoint"));
    }

    #[test]
    fn list_sessions_collapses_to_latest_index_entry() {
        let dir = TempDir::new().unwrap();
        let store = HistoryStore::open(dir.path()).unwrap();
        let session_id = Uuid::new_v4();
        store
            .append_event(&make_event(session_id, EventType::SessionStart, "started"))
            .unwrap();
        store
            .append_event(&make_event(session_id, EventType::SessionEnd, "ended"))
            .unwrap();

        let sessions = store.list_sessions(10, Some("completed")).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, session_id.to_string());
        assert_eq!(sessions[0].status, "completed");
    }

    #[test]
    fn search_history_finds_summary_and_file_path() {
        let dir = TempDir::new().unwrap();
        let store = HistoryStore::open(dir.path()).unwrap();
        let session_id = Uuid::new_v4();
        let mut event = make_event(session_id, EventType::Checkpoint, "added auth");
        event.payload.file_changes = Some(vec![FileChange {
            path: "src/auth.rs".to_string(),
            action: FileAction::Modified,
            lines_added: 3,
            lines_removed: 1,
        }]);
        store.append_event(&event).unwrap();

        let hits = store
            .search_history(Some("auth"), Some("src/auth"), Some("checkpoint"), 10)
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].session_id, session_id.to_string());
    }
}
