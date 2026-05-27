use rmcp::handler::server::wrapper::Parameters;
use rmcp::{model::*, tool, tool_handler, tool_router, ServerHandler};
use schemars::JsonSchema;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::config::AppConfig;
use crate::history::{HistoryStore, SearchHit, SessionIndexEntry};
use crate::mcp::schema::*;
use crate::security::pii_filter::PiiFilter;

/// State for each active session
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct SessionState {
    pub session_id: Uuid,
    pub objective: Option<String>,
    pub actor: Actor,
    pub file_changes: Vec<FileChange>,
    pub tags: Vec<String>,
    pub estimated_tokens: u32,
}

/// Tarae MCP Server — implements start_session, checkpoint, report_issue, fetch_past_context
#[derive(Clone)]
pub struct TaraeServer {
    pub(crate) config: Arc<AppConfig>,
    sessions: Arc<RwLock<HashMap<Uuid, SessionState>>>,
    active_session_id: Arc<RwLock<Option<Uuid>>>,
}

impl TaraeServer {
    pub fn new(config: Arc<AppConfig>) -> Self {
        Self {
            config,
            sessions: Arc::new(RwLock::new(HashMap::new())),
            active_session_id: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn is_active_session_running(&self) -> bool {
        // 1st: in-memory check (same process that called start_session)
        if self.active_session_id.read().await.is_some() {
            return true;
        }
        // 2nd: file check (cross-process — e.g., daemon reading MCP stdio's session)
        match self.history_store() {
            Ok(store) => store.get_active_session().unwrap_or(None).is_some(),
            Err(_) => false,
        }
    }

    fn history_store(&self) -> Result<HistoryStore, String> {
        let root = self
            .config
            .project_root
            .as_deref()
            .ok_or_else(|| "No project root configured for local Tarae history".to_string())?;
        HistoryStore::open(root).map_err(|e| e.to_string())
    }

    pub(crate) async fn create_event(
        &self,
        event_type: EventType,
        payload: EventPayload,
    ) -> TopaEvent {
        let active_id = self.active_session_id.read().await;

        let mut event = TopaEvent::new(
            event_type,
            Actor {
                actor_type: ActorType::AiAgent,
                agent_name: Some("mcp-client".to_string()),
            },
            payload,
        );
        event.session_id = *active_id;
        event
    }

    pub(crate) async fn record_event(&self, event: &TopaEvent) -> String {
        match self
            .history_store()
            .and_then(|store| store.append_event(event).map_err(|e| e.to_string()))
        {
            Ok(message) => message,
            Err(e) => {
                tracing::warn!("Failed to record event locally: {}", e);
                format!("Failed to record event locally: {e}")
            }
        }
    }
}

// -- Tool parameter schemas --

#[derive(Debug, Deserialize, JsonSchema)]
pub struct StartSessionParams {
    /// What is the goal of this coding session?
    pub objective: String,
    /// Name of the AI agent (e.g., "cursor", "copilot", "claude")
    #[serde(default)]
    pub agent_name: Option<String>,
    /// Optional tags for this session (e.g., "#backend", "#auth")
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CheckpointParams {
    /// Brief summary of what was just done. Write in the user's language.
    pub summary: String,
    /// List of files that were changed
    #[serde(default)]
    pub files_changed: Vec<FileChangeInput>,
    /// Estimated tokens used since last checkpoint
    #[serde(default)]
    pub estimated_tokens: Option<u32>,
    /// Optional tags
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct FileChangeInput {
    pub path: String,
    /// One of: created, modified, deleted, renamed
    #[serde(default = "default_action")]
    pub action: String,
    #[serde(default)]
    pub lines_added: u32,
    #[serde(default)]
    pub lines_removed: u32,
}

fn default_action() -> String {
    "modified".to_string()
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ReportIssueParams {
    /// Error message or issue description
    pub error_message: String,
    /// Relevant log output (last few lines)
    #[serde(default)]
    pub log_tail: Vec<String>,
    /// Runtime or framework version info
    #[serde(default)]
    pub runtime_version: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct EndSessionParams {
    /// Final summary of the session. Write in the user's language.
    #[serde(default)]
    pub summary: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct FetchContextParams {
    /// Optional: specific session ID to fetch context for
    #[serde(default)]
    pub session_id: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ListSessionsParams {
    /// Maximum number of sessions to return
    #[serde(default = "default_session_limit")]
    pub limit: usize,
    /// Optional status filter: active or completed
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ReadSessionParams {
    /// Session ID, or a local synthetic ID such as human-YYYY-MM-DD
    pub session_id: String,
    /// Output format: markdown or jsonl
    #[serde(default = "default_session_format")]
    pub format: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SearchHistoryParams {
    /// Query text matched against objective, summaries, errors, logs, and file paths
    #[serde(default)]
    pub query: Option<String>,
    /// File path substring to match
    #[serde(default)]
    pub file_path: Option<String>,
    /// Event type filter, e.g. checkpoint, issue_report, session_end
    #[serde(default)]
    pub event_type: Option<String>,
    /// Maximum number of matches to return
    #[serde(default = "default_history_limit")]
    pub limit: usize,
}

fn default_session_limit() -> usize {
    10
}

fn default_history_limit() -> usize {
    20
}

fn default_session_format() -> String {
    "markdown".to_string()
}

// -- Tool implementations --

#[tool_router]
impl TaraeServer {
    #[tool(description = "Start a new AI coding session. Call this when beginning work on a task.")]
    async fn start_session(
        &self,
        Parameters(params): Parameters<StartSessionParams>,
    ) -> Result<String, String> {
        let session_id = Uuid::new_v4();

        let actor = Actor {
            actor_type: ActorType::AiAgent,
            agent_name: params.agent_name.clone(),
        };

        let state = SessionState {
            session_id,
            objective: Some(params.objective.clone()),
            actor: actor.clone(),
            file_changes: Vec::new(),
            tags: params.tags.clone(),
            estimated_tokens: 0,
        };

        {
            let mut sessions = self.sessions.write().await;
            sessions.insert(session_id, state);
        }
        {
            let mut active = self.active_session_id.write().await;
            *active = Some(session_id);
        }

        let payload = EventPayload {
            objective: Some(params.objective.clone()),
            tags: params.tags,
            ..Default::default()
        };

        let mut event = self.create_event(EventType::SessionStart, payload).await;
        event.session_id = Some(session_id);
        event.actor = actor;

        let msg = self.record_event(&event).await;

        // Persist session state for cross-process visibility
        if let Ok(store) = self.history_store() {
            if let Err(e) = store.set_active_session(
                &session_id.to_string(),
                Some(&params.objective),
                params.agent_name.as_deref(),
            ) {
                tracing::warn!("Failed to persist active session: {}", e);
            }
        }

        Ok(format!("✅ Session started: {}\n{}", session_id, msg))
    }

    #[tool(
        description = "Save a checkpoint of current progress. Call after completing a logical unit of work."
    )]
    async fn checkpoint(
        &self,
        Parameters(params): Parameters<CheckpointParams>,
    ) -> Result<String, String> {
        let file_changes: Vec<FileChange> = params
            .files_changed
            .into_iter()
            .map(|fc| {
                let action = match fc.action.as_str() {
                    "created" => FileAction::Created,
                    "deleted" => FileAction::Deleted,
                    "renamed" => FileAction::Renamed,
                    _ => FileAction::Modified,
                };
                FileChange {
                    path: fc.path,
                    action,
                    lines_added: fc.lines_added,
                    lines_removed: fc.lines_removed,
                }
            })
            .collect();

        let file_count = file_changes.len();

        // Apply PII filter to summary
        let filtered_summary = PiiFilter::filter_text(&params.summary);

        // Update session state
        if let Some(session_id) = *self.active_session_id.read().await {
            let mut sessions = self.sessions.write().await;
            if let Some(state) = sessions.get_mut(&session_id) {
                state.file_changes.extend(file_changes.clone());
                if let Some(tokens) = params.estimated_tokens {
                    state.estimated_tokens += tokens;
                }
            }
        }

        // Get git ref
        let git_ref = crate::git::diff::get_current_git_ref().ok();

        let payload = EventPayload {
            summary: Some(filtered_summary.clone()),
            git_ref,
            file_changes: Some(file_changes),
            tags: params.tags,
            estimated_tokens: params.estimated_tokens,
            ..Default::default()
        };

        let event = self.create_event(EventType::Checkpoint, payload).await;
        let msg = self.record_event(&event).await;
        Ok(format!(
            "💾 Checkpoint saved: {} files changed\n{}\n{}",
            file_count, filtered_summary, msg
        ))
    }

    #[tool(description = "Report an error or issue encountered during development.")]
    async fn report_issue(
        &self,
        Parameters(params): Parameters<ReportIssueParams>,
    ) -> Result<String, String> {
        let filtered_message = PiiFilter::filter_text(&params.error_message);

        let payload = EventPayload {
            error_context: Some(ErrorContext {
                error_message: filtered_message.clone(),
                os_info: Some(std::env::consts::OS.to_string()),
                runtime_version: params.runtime_version,
                log_tail: params
                    .log_tail
                    .iter()
                    .map(|l| PiiFilter::filter_text(l))
                    .collect(),
            }),
            ..Default::default()
        };

        let event = self.create_event(EventType::IssueReport, payload).await;
        let msg = self.record_event(&event).await;
        Ok(format!("🐛 Issue reported: {}\n{}", filtered_message, msg))
    }

    #[tool(description = "End the current coding session.")]
    async fn end_session(
        &self,
        Parameters(params): Parameters<EndSessionParams>,
    ) -> Result<String, String> {
        let session_id = {
            let active = self.active_session_id.read().await;
            match *active {
                Some(id) => id,
                None => return Err("No active session to end".to_string()),
            }
        };

        let session_stats = {
            let sessions = self.sessions.read().await;
            sessions
                .get(&session_id)
                .map(|s| (s.file_changes.len(), s.estimated_tokens))
        };

        let payload = EventPayload {
            summary: params.summary,
            ..Default::default()
        };

        let event = self.create_event(EventType::SessionEnd, payload).await;
        let msg = self.record_event(&event).await;

        // Clear active session
        {
            let mut active = self.active_session_id.write().await;
            *active = None;
        }

        // Clear from local history state for cross-process visibility
        if let Ok(store) = self.history_store() {
            if let Err(e) = store.clear_active_session() {
                tracing::warn!("Failed to clear active session: {}", e);
            }
        }

        let (files, tokens) = session_stats.unwrap_or((0, 0));
        Ok(format!(
            "✅ Session {} ended\nFiles changed: {}, Tokens used: ~{}\n{}",
            session_id, files, tokens, msg
        ))
    }

    #[tool(
        description = "Fetch past context and suggestions for the current project. Useful for getting an overview of recent work."
    )]
    async fn fetch_past_context(
        &self,
        Parameters(params): Parameters<FetchContextParams>,
    ) -> Result<String, String> {
        let store = self.history_store()?;
        if let Some(session_id) = params.session_id {
            return store
                .read_session_markdown(&session_id)
                .map(|content| format!("📋 Past Context:\n{content}"))
                .map_err(|e| e.to_string());
        }

        let sessions = store.list_sessions(5, None).map_err(|e| e.to_string())?;
        if sessions.is_empty() {
            return Ok("ℹ️ No local Tarae sessions found yet.".to_string());
        }

        Ok(format_sessions("📋 Recent Tarae Sessions", &sessions))
    }

    #[tool(description = "List recent local Tarae sessions from .tarae/topa.")]
    async fn list_sessions(
        &self,
        Parameters(params): Parameters<ListSessionsParams>,
    ) -> Result<String, String> {
        let store = self.history_store()?;
        let sessions = store
            .list_sessions(params.limit, params.status.as_deref())
            .map_err(|e| e.to_string())?;
        Ok(format_sessions("📚 Tarae Sessions", &sessions))
    }

    #[tool(description = "Read a local Tarae session as markdown or jsonl.")]
    async fn read_session(
        &self,
        Parameters(params): Parameters<ReadSessionParams>,
    ) -> Result<String, String> {
        let store = self.history_store()?;
        match params.format.as_str() {
            "jsonl" => store
                .read_session_jsonl(&params.session_id)
                .map_err(|e| e.to_string()),
            _ => store
                .read_session_markdown(&params.session_id)
                .map_err(|e| e.to_string()),
        }
    }

    #[tool(description = "Search local Tarae history by query, file path, and event type.")]
    async fn search_history(
        &self,
        Parameters(params): Parameters<SearchHistoryParams>,
    ) -> Result<String, String> {
        let store = self.history_store()?;
        let hits = store
            .search_history(
                params.query.as_deref(),
                params.file_path.as_deref(),
                params.event_type.as_deref(),
                params.limit,
            )
            .map_err(|e| e.to_string())?;
        Ok(format_search_hits(&hits))
    }
}

fn format_sessions(title: &str, sessions: &[SessionIndexEntry]) -> String {
    if sessions.is_empty() {
        return format!("{title}\nNo sessions found.");
    }

    let mut out = format!("{title}\n");
    for session in sessions {
        out.push_str(&format!(
            "- {} [{}] updated={} events={}",
            session.session_id, session.status, session.updated_at, session.event_count
        ));
        if let Some(objective) = &session.objective {
            out.push_str(&format!("\n  Objective: {objective}"));
        }
        if let Some(summary) = &session.last_summary {
            out.push_str(&format!("\n  Last: {summary}"));
        }
        out.push('\n');
    }
    out
}

fn format_search_hits(hits: &[SearchHit]) -> String {
    if hits.is_empty() {
        return "No local Tarae history matches found.".to_string();
    }

    let mut out = "🔎 Tarae History Matches\n".to_string();
    for hit in hits {
        out.push_str(&format!(
            "- {} {} {}",
            hit.timestamp, hit.session_id, hit.event_type
        ));
        if let Some(summary) = &hit.summary {
            out.push_str(&format!("\n  Summary: {summary}"));
        }
        if !hit.files.is_empty() {
            out.push_str(&format!("\n  Files: {}", hit.files.join(", ")));
        }
        out.push('\n');
    }
    out
}

#[tool_handler]
impl ServerHandler for TaraeServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(
            ServerCapabilities::builder()
                .enable_tools()
                .build(),
        )
        .with_server_info(Implementation::from_build_env())
        .with_instructions("Topa (톺아) — Tarae's non-invasive local observer & MCP server. Use start_session to begin tracking, checkpoint to save progress, report_issue to log errors, end_session to close work, and list_sessions/read_session/search_history/fetch_past_context for local project history. Write checkpoint and session summaries in the user's language; if unsure, use TARAE_SUMMARY_LANGUAGE or Korean.")
    }
}
