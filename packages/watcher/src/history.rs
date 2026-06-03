use anyhow::{Context, Result};
use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use crate::mcp::schema::{
    ActorType, AttributionStatus, EventPayload, EventType, FileAction, FileChange, GitRef,
    TopaEvent,
};

const EVENT_SCHEMA_VERSION: &str = "topa-event-v1";
const SESSION_DOC_SCHEMA_VERSION: &str = "topa-session-v1";
const INDEX_SCHEMA_VERSION: &str = "topa-session-index-v1";
const ACTIVE_SESSIONS_SCHEMA_VERSION: &str = "topa-active-sessions-v1";
const HISTORY_LOCK_STALE_AFTER: Duration = Duration::from_secs(30);

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
    pub link_id: Option<String>,
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
    #[serde(default)]
    pub active_key: Option<String>,
    pub session_id: String,
    pub objective: Option<String>,
    pub agent_name: Option<String>,
    #[serde(default)]
    pub link_id: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveSessionsDocument {
    pub schema_version: String,
    #[serde(default)]
    pub sessions: Vec<ActiveSessionRecord>,
}

#[derive(Debug, Clone, Default)]
pub struct SearchCriteria {
    pub query: Option<String>,
    pub file_path: Option<String>,
    pub event_type: Option<String>,
    pub agent_name: Option<String>,
    pub link_id: Option<String>,
    pub session_id: Option<String>,
    pub status: Option<String>,
    pub tag: Option<String>,
    pub after: Option<String>,
    pub before: Option<String>,
    pub limit: usize,
    pub sort_desc: bool,
}

#[derive(Debug, Clone)]
pub struct SearchHit {
    pub session_id: String,
    pub event_type: String,
    pub timestamp: String,
    pub agent_name: Option<String>,
    pub link_id: Option<String>,
    pub status: Option<String>,
    pub summary: Option<String>,
    pub files: Vec<String>,
    pub snippet: Option<String>,
    pub matched_fields: Vec<String>,
}

struct HistoryWriteLock {
    path: PathBuf,
}

impl Drop for HistoryWriteLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

pub fn active_session_owner_key(agent_name: Option<&str>, link_id: Option<&str>) -> String {
    if let Some(link_id) = normalized_key_part(link_id) {
        return format!("link:{link_id}");
    }
    if let Some(agent_name) = normalized_key_part(agent_name) {
        return format!("agent:{agent_name}");
    }
    "agent:mcp-client".to_string()
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
        let _lock = self.acquire_write_lock()?;
        if event.schema_version != EVENT_SCHEMA_VERSION {
            anyhow::bail!("unsupported event schema: {}", event.schema_version);
        }

        if event.event_type == EventType::SessionStart && event.session_id.is_some() {
            self.complete_active_human_sessions(event.timestamp)?;
        }

        let session_key = self.session_key(event);
        let markdown_path = self.append_event_to_session(&session_key, event, true)?;

        Ok(format!(
            "Event {} recorded in {}",
            event.event_id,
            markdown_path.display()
        ))
    }

    fn append_event_to_session(
        &self,
        session_key: &str,
        event: &TopaEvent,
        update_latest: bool,
    ) -> Result<PathBuf> {
        let jsonl_path = self.session_jsonl_path(session_key);
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&jsonl_path)
            .with_context(|| format!("failed to open {}", jsonl_path.display()))?;
        serde_json::to_writer(&mut file, event)?;
        writeln!(file)?;

        let events = self.read_events(session_key)?;
        let markdown = self.render_session_markdown(session_key, &events);
        let markdown_path = self.session_markdown_path(session_key);
        fs::write(&markdown_path, markdown)
            .with_context(|| format!("failed to write {}", markdown_path.display()))?;
        if update_latest {
            fs::copy(&markdown_path, self.topa_dir.join("latest.md")).with_context(|| {
                format!(
                    "failed to update {}",
                    self.topa_dir.join("latest.md").display()
                )
            })?;
        }

        let index_entry = self.build_index_entry(session_key, &events);
        self.append_index_entry(&index_entry)?;

        Ok(markdown_path)
    }

    pub fn set_active_session(
        &self,
        session_id: &str,
        objective: Option<&str>,
        agent_name: Option<&str>,
        link_id: Option<&str>,
    ) -> Result<()> {
        let _lock = self.acquire_write_lock()?;
        let active_key = active_session_owner_key(agent_name, link_id);
        let mut records = self.read_active_session_records_unlocked()?;
        records.retain(|record| active_record_key(record) != active_key);
        let record = ActiveSessionRecord {
            active_key: Some(active_key),
            session_id: session_id.to_string(),
            objective: objective.map(str::to_string),
            agent_name: agent_name.map(str::to_string),
            link_id: link_id.map(str::to_string),
            updated_at: Utc::now().to_rfc3339(),
        };
        records.push(record);
        self.write_active_session_records_unlocked(&records)?;
        Ok(())
    }

    pub fn clear_active_session(&self, active_key: Option<&str>) -> Result<()> {
        let _lock = self.acquire_write_lock()?;
        let Some(active_key) = active_key else {
            self.write_active_session_records_unlocked(&[])?;
            return Ok(());
        };
        let mut records = self.read_active_session_records_unlocked()?;
        records.retain(|record| active_record_key(record) != active_key);
        self.write_active_session_records_unlocked(&records)?;
        Ok(())
    }

    pub fn get_active_session_records(&self) -> Result<Vec<ActiveSessionRecord>> {
        self.read_active_session_records_unlocked()
    }

    pub fn get_active_session_record(
        &self,
        active_key: &str,
    ) -> Result<Option<ActiveSessionRecord>> {
        Ok(self
            .read_active_session_records_unlocked()?
            .into_iter()
            .find(|record| active_record_key(record) == active_key))
    }

    pub fn get_only_active_session_record(&self) -> Result<Option<ActiveSessionRecord>> {
        let records = self.read_active_session_records_unlocked()?;
        if records.len() == 1 {
            Ok(records.into_iter().next())
        } else {
            Ok(None)
        }
    }

    pub fn list_sessions(
        &self,
        limit: usize,
        status: Option<&str>,
    ) -> Result<Vec<SessionIndexEntry>> {
        let mut entries = self.latest_index_entries()?;
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

    pub fn search_history(&self, criteria: SearchCriteria) -> Result<Vec<SearchHit>> {
        let query = criteria.query.as_deref().map(str::to_ascii_lowercase);
        let file_path = criteria.file_path.as_deref().map(str::to_ascii_lowercase);
        let event_type = criteria.event_type.as_deref().map(str::to_ascii_lowercase);
        let agent_name = criteria.agent_name.as_deref().map(str::to_ascii_lowercase);
        let link_id = criteria.link_id.as_deref().map(str::to_ascii_lowercase);
        let session_filter = criteria.session_id.as_deref().map(str::to_ascii_lowercase);
        let status_filter = criteria.status.as_deref().map(str::to_ascii_lowercase);
        let tag_filter = criteria.tag.as_deref().map(str::to_ascii_lowercase);
        let after = parse_date_filter(criteria.after.as_deref(), false)?;
        let before = parse_date_filter(criteria.before.as_deref(), true)?;
        let limit = criteria.limit.max(1);
        let mut hits = Vec::new();

        if !self.sessions_dir.exists() {
            return Ok(hits);
        }

        let sessions = self
            .latest_index_entries()?
            .into_iter()
            .map(|entry| (entry.session_id.clone(), entry))
            .collect::<HashMap<_, _>>();

        let mut paths = fs::read_dir(&self.sessions_dir)?
            .collect::<std::io::Result<Vec<_>>>()?
            .into_iter()
            .map(|entry| entry.path())
            .collect::<Vec<_>>();
        paths.sort();

        for path in paths {
            if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                continue;
            }
            let Some(session_id) = path.file_stem().and_then(|stem| stem.to_str()) else {
                continue;
            };
            let session = sessions.get(session_id);

            if let Some(expected_session) = &session_filter {
                if !session_id.to_ascii_lowercase().contains(expected_session) {
                    continue;
                }
            }

            if let Some(expected_status) = &status_filter {
                let status = session
                    .map(|entry| entry.status.as_str())
                    .unwrap_or("active");
                if status.to_ascii_lowercase() != *expected_status {
                    continue;
                }
            }

            for event in self.read_events(session_id)? {
                if let Some(after) = &after {
                    if event.timestamp < *after {
                        continue;
                    }
                }
                if let Some(before) = &before {
                    if event.timestamp > *before {
                        continue;
                    }
                }

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

                if let Some(expected_agent) = &agent_name {
                    let agents = [
                        event.actor.agent_name.as_deref(),
                        session.and_then(|entry| entry.agent_name.as_deref()),
                    ];
                    if !agents
                        .iter()
                        .flatten()
                        .any(|agent| agent.to_ascii_lowercase().contains(expected_agent))
                    {
                        continue;
                    }
                }

                if let Some(expected_link) = &link_id {
                    let links = [
                        event.actor.link_id.as_deref(),
                        session.and_then(|entry| entry.link_id.as_deref()),
                    ];
                    if !links
                        .iter()
                        .flatten()
                        .any(|link| link.to_ascii_lowercase().contains(expected_link))
                    {
                        continue;
                    }
                }

                if let Some(expected_tag) = &tag_filter {
                    let tag_matches_event = event
                        .payload
                        .tags
                        .iter()
                        .any(|tag| tag.to_ascii_lowercase().contains(expected_tag));
                    let tag_matches_session = session
                        .map(|entry| {
                            entry
                                .tags
                                .iter()
                                .any(|tag| tag.to_ascii_lowercase().contains(expected_tag))
                        })
                        .unwrap_or(false);
                    if !tag_matches_event && !tag_matches_session {
                        continue;
                    }
                }

                let haystack = event_search_text(session, &event, &files);
                let normalized_haystack = haystack.to_ascii_lowercase();
                if let Some(expected_query) = &query {
                    if !normalized_haystack.contains(expected_query) {
                        continue;
                    }
                }

                let mut matched_fields = Vec::new();
                if query.is_some() {
                    matched_fields.push("query".to_string());
                }
                if file_path.is_some() {
                    matched_fields.push("file_path".to_string());
                }
                if event_type.is_some() {
                    matched_fields.push("event_type".to_string());
                }
                if agent_name.is_some() {
                    matched_fields.push("agent_name".to_string());
                }
                if link_id.is_some() {
                    matched_fields.push("link_id".to_string());
                }
                if session_filter.is_some() {
                    matched_fields.push("session_id".to_string());
                }
                if status_filter.is_some() {
                    matched_fields.push("status".to_string());
                }
                if tag_filter.is_some() {
                    matched_fields.push("tag".to_string());
                }
                if after.is_some() || before.is_some() {
                    matched_fields.push("timestamp".to_string());
                }

                let first_needle = query
                    .as_deref()
                    .or(file_path.as_deref())
                    .or(agent_name.as_deref())
                    .or(link_id.as_deref())
                    .or(tag_filter.as_deref());

                hits.push(SearchHit {
                    session_id: session_id.to_string(),
                    event_type: event_type_name(&event.event_type).to_string(),
                    timestamp: event.timestamp.to_rfc3339(),
                    agent_name: event
                        .actor
                        .agent_name
                        .clone()
                        .or_else(|| session.and_then(|entry| entry.agent_name.clone())),
                    link_id: event
                        .actor
                        .link_id
                        .clone()
                        .or_else(|| session.and_then(|entry| entry.link_id.clone())),
                    status: session.map(|entry| entry.status.clone()),
                    summary: event_summary(&event.payload),
                    files,
                    snippet: first_needle.and_then(|needle| first_matching_line(&haystack, needle)),
                    matched_fields,
                });
            }
        }

        hits.sort_by(|a, b| {
            if criteria.sort_desc {
                b.timestamp.cmp(&a.timestamp)
            } else {
                a.timestamp.cmp(&b.timestamp)
            }
        });
        hits.truncate(limit);
        Ok(hits)
    }

    fn session_key(&self, event: &TopaEvent) -> String {
        if let Some(session_id) = event.session_id {
            return session_id.to_string();
        }

        match event.actor.actor_type {
            ActorType::Human => format!("human-{}", event.timestamp.format("%Y-%m-%d")),
            ActorType::AiAgent => {
                let prefix = event
                    .payload
                    .attribution
                    .as_ref()
                    .map(|attribution| match attribution.status {
                        AttributionStatus::AmbiguousActiveSessions => "ambiguous",
                        AttributionStatus::HeuristicAi => "ai-heuristic",
                        _ => "ai",
                    })
                    .unwrap_or("ai");
                format!("{}-{}", prefix, event.timestamp.format("%Y-%m-%d"))
            }
        }
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

    fn active_session_path(&self) -> PathBuf {
        self.topa_dir.join("active_session.json")
    }

    fn active_sessions_path(&self) -> PathBuf {
        self.topa_dir.join("active_sessions.json")
    }

    fn read_active_session_records_unlocked(&self) -> Result<Vec<ActiveSessionRecord>> {
        let active_sessions_path = self.active_sessions_path();
        if active_sessions_path.exists() {
            let document: ActiveSessionsDocument =
                serde_json::from_slice(&fs::read(active_sessions_path)?)?;
            return Ok(document.sessions);
        }

        let legacy_path = self.active_session_path();
        if !legacy_path.exists() {
            return Ok(Vec::new());
        }
        let mut record: ActiveSessionRecord = serde_json::from_slice(&fs::read(legacy_path)?)?;
        if record.active_key.is_none() {
            record.active_key = Some(active_record_key(&record));
        }
        Ok(vec![record])
    }

    fn write_active_session_records_unlocked(&self, records: &[ActiveSessionRecord]) -> Result<()> {
        let active_sessions_path = self.active_sessions_path();
        if records.is_empty() {
            let _ = fs::remove_file(active_sessions_path);
            let _ = fs::remove_file(self.active_session_path());
            return Ok(());
        }

        let document = ActiveSessionsDocument {
            schema_version: ACTIVE_SESSIONS_SCHEMA_VERSION.to_string(),
            sessions: records.to_vec(),
        };
        fs::write(
            active_sessions_path,
            serde_json::to_string_pretty(&document)?,
        )?;

        if records.len() == 1 {
            fs::write(
                self.active_session_path(),
                serde_json::to_string_pretty(&records[0])?,
            )?;
        } else {
            let _ = fs::remove_file(self.active_session_path());
        }
        Ok(())
    }

    fn acquire_write_lock(&self) -> Result<HistoryWriteLock> {
        let lock_path = self.topa_dir.join("history.lock");
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            match OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&lock_path)
            {
                Ok(mut file) => {
                    writeln!(file, "pid={}", std::process::id())?;
                    writeln!(file, "created_at={}", Utc::now().to_rfc3339())?;
                    return Ok(HistoryWriteLock { path: lock_path });
                }
                Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                    if is_stale_lock(&lock_path) {
                        let _ = fs::remove_file(&lock_path);
                        continue;
                    }
                    if std::time::Instant::now() >= deadline {
                        anyhow::bail!(
                            "timed out waiting for history write lock at {}",
                            lock_path.display()
                        );
                    }
                    std::thread::sleep(Duration::from_millis(25));
                }
                Err(err) => return Err(err.into()),
            }
        }
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

    fn latest_index_entries(&self) -> Result<Vec<SessionIndexEntry>> {
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

        Ok(latest_by_session.into_values().collect())
    }

    fn complete_active_human_sessions(&self, ended_at: chrono::DateTime<Utc>) -> Result<()> {
        for entry in self.latest_index_entries()? {
            if entry.status != "active" || !entry.session_id.starts_with("human-") {
                continue;
            }

            let mut event = TopaEvent::new(
                EventType::SessionEnd,
                crate::mcp::schema::Actor {
                    actor_type: ActorType::Human,
                    agent_name: None,
                    link_id: None,
                },
                EventPayload::default(),
            );
            event.timestamp = ended_at;
            self.append_event_to_session(&entry.session_id, &event, false)?;
        }

        Ok(())
    }

    fn build_index_entry(&self, session_id: &str, events: &[TopaEvent]) -> SessionIndexEntry {
        let mut objective = None;
        let mut agent_name = None;
        let mut link_id = None;
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
                link_id = event.actor.link_id.clone();
                tags = event.payload.tags.clone();
            }
            if event.event_type == EventType::SessionEnd {
                status = "completed".to_string();
                ended_at = Some(event.timestamp.to_rfc3339());
            }
            if session_id.starts_with("human-") && event.event_type == EventType::HumanIntervention
            {
                status = "active".to_string();
                ended_at = None;
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
            link_id,
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
        out.push_str(&format!(
            "link_id: {}\n",
            yaml_optional(index.link_id.as_deref())
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

fn normalized_key_part(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
}

fn active_record_key(record: &ActiveSessionRecord) -> String {
    record.active_key.clone().unwrap_or_else(|| {
        active_session_owner_key(record.agent_name.as_deref(), record.link_id.as_deref())
    })
}

fn parse_date_filter(value: Option<&str>, end_of_day: bool) -> Result<Option<DateTime<Utc>>> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };

    if let Ok(timestamp) = DateTime::parse_from_rfc3339(value) {
        return Ok(Some(timestamp.with_timezone(&Utc)));
    }

    if let Ok(date) = NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        let time = if end_of_day {
            date.and_hms_opt(23, 59, 59)
        } else {
            date.and_hms_opt(0, 0, 0)
        }
        .expect("valid fixed date time");
        return Ok(Some(Utc.from_utc_datetime(&time)));
    }

    anyhow::bail!("invalid date filter: {value}. Use YYYY-MM-DD or RFC3339.")
}

fn event_search_text(
    session: Option<&SessionIndexEntry>,
    event: &TopaEvent,
    files: &[String],
) -> String {
    let mut haystack = String::new();
    if let Some(session) = session {
        push_optional(&mut haystack, Some(&session.session_id));
        push_optional(&mut haystack, session.objective.as_deref());
        push_optional(&mut haystack, session.agent_name.as_deref());
        push_optional(&mut haystack, session.link_id.as_deref());
        push_optional(&mut haystack, Some(&session.status));
        push_optional(&mut haystack, session.last_summary.as_deref());
        for tag in &session.tags {
            push_optional(&mut haystack, Some(tag));
        }
    }
    push_optional(&mut haystack, Some(&event.event_id.to_string()));
    push_optional(&mut haystack, Some(event_type_name(&event.event_type)));
    push_optional(&mut haystack, Some(&event.timestamp.to_rfc3339()));
    if let Some(session_id) = event.session_id {
        push_optional(&mut haystack, Some(&session_id.to_string()));
    }
    push_optional(&mut haystack, event.actor.agent_name.as_deref());
    push_optional(&mut haystack, event.actor.link_id.as_deref());
    push_optional(&mut haystack, event.payload.summary.as_deref());
    push_optional(&mut haystack, event.payload.objective.as_deref());
    for tag in &event.payload.tags {
        push_optional(&mut haystack, Some(tag));
    }
    if let Some(git_ref) = &event.payload.git_ref {
        push_optional(&mut haystack, Some(&git_ref.branch));
        push_optional(&mut haystack, Some(&git_ref.commit_hash));
        push_optional(&mut haystack, git_ref.commit_message.as_deref());
    }
    if let Some(error) = &event.payload.error_context {
        push_optional(&mut haystack, Some(&error.error_message));
        push_optional(&mut haystack, error.runtime_version.as_deref());
        for line in &error.log_tail {
            push_optional(&mut haystack, Some(line));
        }
    }
    if let Some(attribution) = &event.payload.attribution {
        push_optional(
            &mut haystack,
            Some(attribution_status_name(&attribution.status)),
        );
        push_optional(&mut haystack, attribution.reason.as_deref());
        for session_id in &attribution.candidate_session_ids {
            push_optional(&mut haystack, Some(session_id));
        }
    }
    for file in files {
        push_optional(&mut haystack, Some(file));
    }
    haystack
}

fn first_matching_line(text: &str, normalized_query: &str) -> Option<String> {
    for line in text.lines() {
        if line
            .to_ascii_lowercase()
            .contains(&normalized_query.to_ascii_lowercase())
        {
            return Some(line.trim().chars().take(240).collect());
        }
    }
    None
}

fn is_stale_lock(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return true;
    };
    let Ok(modified) = metadata.modified() else {
        return true;
    };
    SystemTime::now()
        .duration_since(modified)
        .map(|age| age > HISTORY_LOCK_STALE_AFTER)
        .unwrap_or(true)
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
        ActorType::AiAgent => {
            let mut parts = Vec::new();
            if let Some(name) = event.actor.agent_name.as_deref() {
                parts.push(name.to_string());
            }
            if let Some(link_id) = event.actor.link_id.as_deref() {
                parts.push(format!("link={link_id}"));
            }
            if parts.is_empty() {
                "ai_agent".to_string()
            } else {
                format!("ai_agent ({})", parts.join(", "))
            }
        }
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
    if let Some(attribution) = &payload.attribution {
        out.push_str(&format!(
            "Attribution: {}",
            attribution_status_name(&attribution.status)
        ));
        if attribution.active_session_count > 0 {
            out.push_str(&format!(
                " (active_sessions={})",
                attribution.active_session_count
            ));
        }
        if !attribution.candidate_session_ids.is_empty() {
            out.push_str(&format!(
                ", candidates={}",
                attribution.candidate_session_ids.join(", ")
            ));
        }
        if let Some(reason) = &attribution.reason {
            out.push_str(&format!(", reason={reason}"));
        }
        out.push_str("\n\n");
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

fn attribution_status_name(status: &AttributionStatus) -> &'static str {
    match status {
        AttributionStatus::Explicit => "explicit",
        AttributionStatus::SingleActiveSession => "single_active_session",
        AttributionStatus::AmbiguousActiveSessions => "ambiguous_active_sessions",
        AttributionStatus::HeuristicAi => "heuristic_ai",
        AttributionStatus::Human => "human",
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
    use chrono::TimeZone;
    use tempfile::TempDir;
    use uuid::Uuid;

    fn make_event(session_id: Uuid, event_type: EventType, summary: &str) -> TopaEvent {
        let mut event = TopaEvent::new(
            event_type,
            Actor {
                actor_type: ActorType::AiAgent,
                agent_name: Some("codex".to_string()),
                link_id: Some("codex-default".to_string()),
            },
            EventPayload {
                summary: Some(summary.to_string()),
                ..Default::default()
            },
        );
        event.session_id = Some(session_id);
        event
    }

    fn make_human_event_at(timestamp: chrono::DateTime<Utc>, summary: &str) -> TopaEvent {
        let mut event = TopaEvent::new(
            EventType::HumanIntervention,
            Actor {
                actor_type: ActorType::Human,
                agent_name: None,
                link_id: None,
            },
            EventPayload {
                summary: Some(summary.to_string()),
                ..Default::default()
            },
        );
        event.timestamp = timestamp;
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
    fn new_ai_session_completes_active_human_session() {
        let dir = TempDir::new().unwrap();
        let store = HistoryStore::open(dir.path()).unwrap();
        let human_at = Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0).unwrap();

        store
            .append_event(&make_human_event_at(human_at, "manual edits"))
            .unwrap();

        let active = store.list_sessions(10, Some("active")).unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].session_id, "human-2026-01-01");

        let session_id = Uuid::new_v4();
        let mut start = make_event(session_id, EventType::SessionStart, "started");
        start.timestamp = human_at + chrono::Duration::minutes(10);
        store.append_event(&start).unwrap();

        let completed = store.list_sessions(10, Some("completed")).unwrap();
        let human = completed
            .iter()
            .find(|entry| entry.session_id == "human-2026-01-01")
            .unwrap();
        assert_eq!(human.status, "completed");
        let expected_ended_at = start.timestamp.to_rfc3339();
        assert_eq!(human.ended_at.as_deref(), Some(expected_ended_at.as_str()));

        let active = store.list_sessions(10, Some("active")).unwrap();
        let ai_session_id = session_id.to_string();
        assert!(active
            .iter()
            .any(|entry| entry.session_id == ai_session_id.as_str()));
        assert!(!active
            .iter()
            .any(|entry| entry.session_id == "human-2026-01-01"));

        let markdown = store.read_session_markdown("human-2026-01-01").unwrap();
        assert!(markdown.contains("status: \"completed\""));
        assert!(store
            .read_session_jsonl("human-2026-01-01")
            .unwrap()
            .contains("\"session_end\""));
    }

    #[test]
    fn human_session_reopens_after_new_human_activity_on_same_day() {
        let dir = TempDir::new().unwrap();
        let store = HistoryStore::open(dir.path()).unwrap();
        let human_at = Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0).unwrap();

        store
            .append_event(&make_human_event_at(human_at, "manual edits"))
            .unwrap();

        let session_id = Uuid::new_v4();
        let mut start = make_event(session_id, EventType::SessionStart, "started");
        start.timestamp = human_at + chrono::Duration::minutes(10);
        store.append_event(&start).unwrap();

        store
            .append_event(&make_human_event_at(
                human_at + chrono::Duration::minutes(20),
                "more manual edits",
            ))
            .unwrap();

        let active = store.list_sessions(10, Some("active")).unwrap();
        let human = active
            .iter()
            .find(|entry| entry.session_id == "human-2026-01-01")
            .unwrap();
        assert_eq!(human.status, "active");
        assert_eq!(human.ended_at, None);

        let markdown = store.read_session_markdown("human-2026-01-01").unwrap();
        assert!(markdown.contains("status: \"active\""));
        assert!(markdown.contains("more manual edits"));
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
            .search_history(SearchCriteria {
                query: Some("auth".to_string()),
                file_path: Some("src/auth".to_string()),
                event_type: Some("checkpoint".to_string()),
                limit: 10,
                sort_desc: true,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].session_id, session_id.to_string());
    }

    #[test]
    fn active_sessions_are_keyed_by_link_id() {
        let dir = TempDir::new().unwrap();
        let store = HistoryStore::open(dir.path()).unwrap();
        let codex_session_id = Uuid::new_v4().to_string();
        let gemini_session_id = Uuid::new_v4().to_string();

        store
            .set_active_session(
                &codex_session_id,
                Some("backend"),
                Some("codex"),
                Some("codex-main"),
            )
            .unwrap();
        store
            .set_active_session(
                &gemini_session_id,
                Some("qa"),
                Some("gemini"),
                Some("gemini-main"),
            )
            .unwrap();

        assert_eq!(store.get_active_session_records().unwrap().len(), 2);
        assert_eq!(
            store
                .get_active_session_record("link:codex-main")
                .unwrap()
                .unwrap()
                .session_id,
            codex_session_id
        );

        store.clear_active_session(Some("link:codex-main")).unwrap();
        let remaining = store.get_active_session_records().unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].session_id, gemini_session_id);
    }

    #[test]
    fn search_history_filters_agent_link_status_tag_and_time() {
        let dir = TempDir::new().unwrap();
        let store = HistoryStore::open(dir.path()).unwrap();
        let session_id = Uuid::new_v4();
        let mut event = make_event(session_id, EventType::SessionStart, "started");
        event.timestamp = Utc.with_ymd_and_hms(2026, 1, 2, 12, 0, 0).unwrap();
        event.payload.objective = Some("build backend".to_string());
        event.payload.tags = vec!["#backend".to_string()];
        store.append_event(&event).unwrap();

        let hits = store
            .search_history(SearchCriteria {
                query: Some("backend".to_string()),
                agent_name: Some("codex".to_string()),
                link_id: Some("codex-default".to_string()),
                status: Some("active".to_string()),
                tag: Some("#backend".to_string()),
                after: Some("2026-01-01".to_string()),
                before: Some("2026-01-03".to_string()),
                limit: 10,
                sort_desc: true,
                ..Default::default()
            })
            .unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].agent_name.as_deref(), Some("codex"));
        assert_eq!(hits[0].link_id.as_deref(), Some("codex-default"));
        assert!(hits[0].matched_fields.contains(&"agent_name".to_string()));
        assert!(hits[0].snippet.as_deref().unwrap_or("").contains("backend"));
    }
}
