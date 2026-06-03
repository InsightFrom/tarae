use rmcp::handler::server::wrapper::Parameters;
use rmcp::{model::*, tool, tool_handler, tool_router, Peer, RoleServer, ServerHandler};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::config::AppConfig;
use crate::history::{
    active_session_owner_key, ActiveSessionRecord, HistoryStore, SearchCriteria, SearchHit,
    SessionIndexEntry,
};
use crate::mcp::schema::*;
use crate::security::pii_filter::PiiFilter;
use crate::watcher::root;

/// State for each active session
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct SessionState {
    pub session_id: Uuid,
    pub project_root: String,
    pub objective: Option<String>,
    pub actor: Actor,
    pub file_changes: Vec<FileChange>,
    pub tags: Vec<String>,
    pub estimated_tokens: u32,
}

#[derive(Debug, Clone)]
struct RequestContext {
    agent_name: Option<String>,
    link_id: Option<String>,
    active_key: String,
    explicit_identity: bool,
}

#[derive(Debug, Clone)]
struct ActiveSessionRef {
    session_id: Uuid,
    active_key: String,
    actor: Actor,
}

/// Project-scoped state owner for sessions, history writes, and file watching.
#[derive(Clone)]
pub struct TaraeCore {
    pub(crate) config: Arc<AppConfig>,
    sessions: Arc<RwLock<HashMap<Uuid, SessionState>>>,
    active_sessions: Arc<RwLock<HashMap<String, Uuid>>>,
    watched_roots: Arc<RwLock<HashSet<String>>>,
}

/// Direct stdio server used only for legacy/debug mode.
#[derive(Clone)]
pub struct TaraeServer {
    core: TaraeCore,
}

/// Stdio MCP bridge that forwards tool calls to the project daemon.
#[derive(Clone)]
pub struct TaraeBridgeServer {
    config: Arc<AppConfig>,
    active_roots: Arc<RwLock<HashSet<String>>>,
}

impl TaraeCore {
    pub fn new(config: Arc<AppConfig>) -> Self {
        Self {
            config,
            sessions: Arc::new(RwLock::new(HashMap::new())),
            active_sessions: Arc::new(RwLock::new(HashMap::new())),
            watched_roots: Arc::new(RwLock::new(HashSet::new())),
        }
    }

    pub async fn start_configured_watcher(&self) {
        match self.resolve_project_root_for_call(None, None, false).await {
            Ok(project_root) => self.start_watcher_if_needed(&project_root).await,
            Err(err) => tracing::warn!(
                "Background file watcher disabled: {err}. Provide project_root to start_session or run topa from a git/project directory."
            ),
        }
    }

    pub async fn start_watcher_if_needed(&self, project_root: &Path) {
        let key = root_key(project_root);
        {
            let mut watched = self.watched_roots.write().await;
            if !watched.insert(key) {
                return;
            }
        }

        crate::watcher::start_background_watcher_for_root(self.clone(), project_root.to_path_buf());
    }

    pub async fn is_active_session_running_for_root(&self, project_root: &Path) -> bool {
        self.active_session_count_for_root(project_root).await > 0
    }

    fn history_store_for_root(&self, project_root: &Path) -> Result<HistoryStore, String> {
        HistoryStore::open(project_root).map_err(|e| e.to_string())
    }

    async fn resolve_project_root_for_call(
        &self,
        explicit_root: Option<&str>,
        peer: Option<&Peer<RoleServer>>,
        allow_active_fallback: bool,
    ) -> Result<PathBuf, String> {
        if let Some(project_root) = explicit_root.map(str::trim).filter(|root| !root.is_empty()) {
            return resolve_safe_project_root(Some(project_root));
        }

        if allow_active_fallback {
            if let Some(project_root) = self.single_active_project_root().await {
                return Ok(project_root);
            }
        }

        if let Some(project_root) = self
            .config
            .project_root
            .as_deref()
            .map(str::trim)
            .filter(|root| !root.is_empty())
        {
            return resolve_safe_project_root(Some(project_root));
        }

        if let Some(peer) = peer {
            if let Some(project_root) = project_root_from_mcp_roots(peer).await {
                return Ok(project_root);
            }
        }

        root::resolve_project_root(None)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| {
                "No project root could be resolved. Pass project_root to start_session or use an MCP client that supports roots/list.".to_string()
            })
    }

    async fn single_active_project_root(&self) -> Option<PathBuf> {
        let active = self.active_sessions.read().await;
        let roots = active
            .keys()
            .filter_map(|key| project_root_from_active_key(key))
            .collect::<HashSet<_>>();
        if roots.len() != 1 {
            return None;
        }
        roots.into_iter().next().map(PathBuf::from)
    }

    fn request_context(&self, agent_name: Option<&str>, link_id: Option<&str>) -> RequestContext {
        let provided_agent = clean_optional(agent_name);
        let configured_agent = clean_optional(self.config.agent_name.as_deref());
        let provided_link = clean_optional(link_id);
        let configured_link = clean_optional(self.config.link_id.as_deref());
        let explicit_identity = provided_agent.is_some()
            || configured_agent.is_some()
            || provided_link.is_some()
            || configured_link.is_some();
        let agent_name = provided_agent
            .or(configured_agent)
            .or_else(|| Some("mcp-client".to_string()));
        let link_id = provided_link.or(configured_link);
        let active_key = active_session_owner_key(agent_name.as_deref(), link_id.as_deref());
        RequestContext {
            agent_name,
            link_id,
            active_key,
            explicit_identity,
        }
    }

    async fn create_event_for_root(
        &self,
        project_root: &Path,
        event_type: EventType,
        mut payload: EventPayload,
        context: &RequestContext,
    ) -> TopaEvent {
        let active = self
            .active_session_ref_for_root(project_root, context)
            .await;

        if payload.attribution.is_none() {
            payload.attribution = Some(Attribution {
                status: AttributionStatus::Explicit,
                reason: None,
                active_session_count: active.as_ref().map(|_| 1).unwrap_or(0),
                candidate_session_ids: active
                    .as_ref()
                    .map(|session| vec![session.session_id.to_string()])
                    .unwrap_or_default(),
            });
        }

        let mut event = TopaEvent::new(
            event_type,
            active
                .as_ref()
                .map(|session| session.actor.clone())
                .unwrap_or_else(|| Actor {
                    actor_type: ActorType::AiAgent,
                    agent_name: context.agent_name.clone(),
                    link_id: context.link_id.clone(),
                }),
            payload,
        );
        event.session_id = active.map(|session| session.session_id);
        event
    }

    pub(crate) async fn create_watcher_event_for_root(
        &self,
        project_root: &Path,
        event_type: EventType,
        mut payload: EventPayload,
    ) -> TopaEvent {
        let active = self.active_session_refs_for_root(project_root).await;
        match active.as_slice() {
            [session] => {
                payload.attribution = Some(Attribution {
                    status: AttributionStatus::SingleActiveSession,
                    reason: Some(
                        "watcher attributed file changes to the only active AI session".to_string(),
                    ),
                    active_session_count: 1,
                    candidate_session_ids: vec![session.session_id.to_string()],
                });
                let mut event = TopaEvent::new(event_type, session.actor.clone(), payload);
                event.session_id = Some(session.session_id);
                event
            }
            [] => {
                payload.attribution = Some(Attribution {
                    status: AttributionStatus::HeuristicAi,
                    reason: Some("watcher saw AI-like activity but no active lifecycle session was identifiable".to_string()),
                    active_session_count: 0,
                    candidate_session_ids: Vec::new(),
                });
                TopaEvent::new(
                    event_type,
                    Actor {
                        actor_type: ActorType::AiAgent,
                        agent_name: Some("mcp-client".to_string()),
                        link_id: None,
                    },
                    payload,
                )
            }
            sessions => {
                payload.attribution = Some(Attribution {
                    status: AttributionStatus::AmbiguousActiveSessions,
                    reason: Some("multiple active AI sessions exist for this project; watcher did not assign changes to one agent".to_string()),
                    active_session_count: sessions.len(),
                    candidate_session_ids: sessions
                        .iter()
                        .map(|session| session.session_id.to_string())
                        .collect(),
                });
                TopaEvent::new(
                    event_type,
                    Actor {
                        actor_type: ActorType::AiAgent,
                        agent_name: Some("multiple-ai-agents".to_string()),
                        link_id: None,
                    },
                    payload,
                )
            }
        }
    }

    pub(crate) async fn record_event_for_root(
        &self,
        project_root: &Path,
        event: &TopaEvent,
    ) -> String {
        match self
            .history_store_for_root(project_root)
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

impl TaraeServer {
    pub fn new(config: Arc<AppConfig>) -> Self {
        Self {
            core: TaraeCore::new(config),
        }
    }

    pub fn core(&self) -> TaraeCore {
        self.core.clone()
    }
}

impl TaraeBridgeServer {
    pub fn new(config: Arc<AppConfig>) -> Self {
        Self {
            config,
            active_roots: Arc::new(RwLock::new(HashSet::new())),
        }
    }

    async fn resolve_project_root_for_call(
        &self,
        explicit_root: Option<&str>,
        peer: Option<&Peer<RoleServer>>,
        allow_active_fallback: bool,
    ) -> Result<PathBuf, String> {
        if let Some(project_root) = explicit_root.map(str::trim).filter(|root| !root.is_empty()) {
            return resolve_safe_project_root(Some(project_root));
        }

        if allow_active_fallback {
            if let Some(project_root) = self.single_active_project_root().await {
                return Ok(project_root);
            }
        }

        if let Some(project_root) = self
            .config
            .project_root
            .as_deref()
            .map(str::trim)
            .filter(|root| !root.is_empty())
        {
            return resolve_safe_project_root(Some(project_root));
        }

        if let Some(peer) = peer {
            if let Some(project_root) = project_root_from_mcp_roots(peer).await {
                return Ok(project_root);
            }
        }

        root::resolve_project_root(None)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| {
                "No project root could be resolved. Pass project_root to start_session or use an MCP client that supports roots/list.".to_string()
            })
    }

    async fn single_active_project_root(&self) -> Option<PathBuf> {
        let active = self.active_roots.read().await;
        if active.len() != 1 {
            return None;
        }
        active.iter().next().map(PathBuf::from)
    }

    async fn remember_active_root(&self, project_root: &Path) {
        self.active_roots
            .write()
            .await
            .insert(root_key(project_root));
    }

    async fn forget_active_root(&self, project_root: &Path) {
        self.active_roots
            .write()
            .await
            .remove(&root_key(project_root));
    }

    fn apply_agent_defaults(&self, agent_name: &mut Option<String>, link_id: &mut Option<String>) {
        if agent_name
            .as_deref()
            .map(str::trim)
            .unwrap_or("")
            .is_empty()
        {
            *agent_name = clean_optional(self.config.agent_name.as_deref());
        }
        if link_id.as_deref().map(str::trim).unwrap_or("").is_empty() {
            *link_id = clean_optional(self.config.link_id.as_deref());
        }
    }

    async fn call_daemon<T: Serialize + ?Sized>(
        &self,
        project_root: &Path,
        method: &str,
        params: &T,
    ) -> Result<String, String> {
        let client = crate::runtime::ensure_daemon(project_root).await?;
        client.call_string(method, params).await
    }
}

// -- Tool parameter schemas --

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct StartSessionParams {
    /// What is the goal of this coding session?
    pub objective: String,
    /// Project root directory for this session. If omitted, Tarae asks the MCP client for roots/list when supported.
    #[serde(default)]
    pub project_root: Option<String>,
    /// Name of the AI agent (e.g., "cursor", "copilot", "claude")
    #[serde(default)]
    pub agent_name: Option<String>,
    /// Stable MCP link identifier. Defaults from TARAE_LINK_ID when linked by Tarae CLI.
    #[serde(default)]
    pub link_id: Option<String>,
    /// Optional tags for this session (e.g., "#backend", "#auth")
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct CheckpointParams {
    /// Brief summary of what was just done. Write in the user's language.
    pub summary: String,
    /// Project root directory for this checkpoint. Usually omitted after start_session.
    #[serde(default)]
    pub project_root: Option<String>,
    /// List of files that were changed
    #[serde(default)]
    pub files_changed: Vec<FileChangeInput>,
    /// Estimated tokens used since last checkpoint
    #[serde(default)]
    pub estimated_tokens: Option<u32>,
    /// Optional tags
    #[serde(default)]
    pub tags: Vec<String>,
    /// Name of the AI agent. Usually supplied automatically by the MCP link.
    #[serde(default)]
    pub agent_name: Option<String>,
    /// Stable MCP link identifier. Usually supplied automatically by the MCP link.
    #[serde(default)]
    pub link_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
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

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ReportIssueParams {
    /// Error message or issue description
    pub error_message: String,
    /// Project root directory for this issue. Usually omitted after start_session.
    #[serde(default)]
    pub project_root: Option<String>,
    /// Relevant log output (last few lines)
    #[serde(default)]
    pub log_tail: Vec<String>,
    /// Runtime or framework version info
    #[serde(default)]
    pub runtime_version: Option<String>,
    /// Name of the AI agent. Usually supplied automatically by the MCP link.
    #[serde(default)]
    pub agent_name: Option<String>,
    /// Stable MCP link identifier. Usually supplied automatically by the MCP link.
    #[serde(default)]
    pub link_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct EndSessionParams {
    /// Final summary of the session. Write in the user's language.
    #[serde(default)]
    pub summary: Option<String>,
    /// Project root directory for the session to end. Usually omitted unless multiple project sessions are active.
    #[serde(default)]
    pub project_root: Option<String>,
    /// Name of the AI agent. Usually supplied automatically by the MCP link.
    #[serde(default)]
    pub agent_name: Option<String>,
    /// Stable MCP link identifier. Usually supplied automatically by the MCP link.
    #[serde(default)]
    pub link_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct FetchContextParams {
    /// Project root directory containing .tarae/topa. If omitted, Tarae asks the MCP client for roots/list when supported.
    #[serde(default)]
    pub project_root: Option<String>,
    /// Optional: specific session ID to fetch context for
    #[serde(default)]
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ListSessionsParams {
    /// Project root directory containing .tarae/topa.
    #[serde(default)]
    pub project_root: Option<String>,
    /// Maximum number of sessions to return
    #[serde(default = "default_session_limit")]
    pub limit: usize,
    /// Optional status filter: active or completed
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ReadSessionParams {
    /// Project root directory containing .tarae/topa.
    #[serde(default)]
    pub project_root: Option<String>,
    /// Session ID, or a local synthetic ID such as human-YYYY-MM-DD
    pub session_id: String,
    /// Output format: markdown or jsonl
    #[serde(default = "default_session_format")]
    pub format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SearchHistoryParams {
    /// Project root directory containing .tarae/topa.
    #[serde(default)]
    pub project_root: Option<String>,
    /// Query text matched against objective, summaries, errors, logs, and file paths
    #[serde(default)]
    pub query: Option<String>,
    /// File path substring to match
    #[serde(default)]
    pub file_path: Option<String>,
    /// Event type filter, e.g. checkpoint, issue_report, session_end
    #[serde(default)]
    pub event_type: Option<String>,
    /// Agent name filter, e.g. codex, gemini, claude
    #[serde(default)]
    pub agent_name: Option<String>,
    /// MCP link id filter
    #[serde(default)]
    pub link_id: Option<String>,
    /// Session id substring filter
    #[serde(default)]
    pub session_id: Option<String>,
    /// Session status filter: active or completed
    #[serde(default)]
    pub status: Option<String>,
    /// Tag substring filter
    #[serde(default)]
    pub tag: Option<String>,
    /// Inclusive lower timestamp bound. Use YYYY-MM-DD or RFC3339.
    #[serde(default)]
    pub after: Option<String>,
    /// Inclusive upper timestamp bound. Use YYYY-MM-DD or RFC3339.
    #[serde(default)]
    pub before: Option<String>,
    /// Sort order: desc or asc
    #[serde(default = "default_search_sort")]
    pub sort: String,
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

fn default_search_sort() -> String {
    "desc".to_string()
}

fn default_session_format() -> String {
    "markdown".to_string()
}

fn root_key(project_root: &Path) -> String {
    project_root.display().to_string()
}

fn active_session_key(project_root: &Path, owner_key: &str) -> String {
    format!("{}\0{}", root_key(project_root), owner_key)
}

fn project_root_from_active_key(active_key: &str) -> Option<String> {
    active_key
        .split_once('\0')
        .map(|(root, _)| root.to_string())
        .or_else(|| Some(active_key.to_string()))
}

fn owner_from_active_session_key(active_key: &str) -> &str {
    active_key
        .split_once('\0')
        .map(|(_, owner)| owner)
        .unwrap_or(active_key)
}

fn clean_optional(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn resolve_safe_project_root(config_root: Option<&str>) -> Result<PathBuf, String> {
    root::resolve_project_root(config_root)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No safe project root detected".to_string())
}

async fn project_root_from_mcp_roots(peer: &Peer<RoleServer>) -> Option<PathBuf> {
    peer.peer_info()?.capabilities.roots.as_ref()?;

    let roots = tokio::time::timeout(Duration::from_secs(2), peer.list_roots())
        .await
        .ok()?
        .ok()?
        .roots;

    for mcp_root in roots {
        let Some(path) = path_from_file_uri(&mcp_root.uri) else {
            continue;
        };
        if let Ok(project_root) = resolve_safe_project_root(Some(&path)) {
            return Some(project_root);
        }
    }

    None
}

fn path_from_file_uri(uri: &str) -> Option<String> {
    let path = uri.strip_prefix("file://")?;
    let path = if cfg!(windows) && path.starts_with('/') && path.get(2..3) == Some(":") {
        &path[1..]
    } else {
        path
    };
    Some(percent_decode(path))
}

fn percent_decode(input: &str) -> String {
    let mut out = Vec::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let high = hex_value(bytes[index + 1]);
            let low = hex_value(bytes[index + 2]);
            if let (Some(high), Some(low)) = (high, low) {
                out.push(high * 16 + low);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

impl TaraeCore {
    pub async fn start_session_for_root(
        &self,
        project_root: PathBuf,
        params: StartSessionParams,
    ) -> Result<String, String> {
        self.start_watcher_if_needed(&project_root).await;
        let context = self.request_context(params.agent_name.as_deref(), params.link_id.as_deref());
        if let Some(existing) = self
            .active_session_ref_for_root(&project_root, &context)
            .await
        {
            return Ok(format!(
                "✅ Session already active: {}\nUsing existing active session for {} ({})",
                existing.session_id,
                project_root.display(),
                context.active_key
            ));
        }

        let project_key = root_key(&project_root);
        let session_id = Uuid::new_v4();
        let actor = Actor {
            actor_type: ActorType::AiAgent,
            agent_name: context.agent_name.clone(),
            link_id: context.link_id.clone(),
        };

        let state = SessionState {
            session_id,
            project_root: project_key.clone(),
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
            let mut active = self.active_sessions.write().await;
            active.insert(
                active_session_key(&project_root, &context.active_key),
                session_id,
            );
        }

        let payload = EventPayload {
            objective: Some(params.objective.clone()),
            tags: params.tags,
            ..Default::default()
        };

        let mut event = self
            .create_event_for_root(&project_root, EventType::SessionStart, payload, &context)
            .await;
        event.session_id = Some(session_id);
        event.actor = actor;

        let msg = self.record_event_for_root(&project_root, &event).await;

        if let Ok(store) = self.history_store_for_root(&project_root) {
            if let Err(e) = store.set_active_session(
                &session_id.to_string(),
                Some(&params.objective),
                context.agent_name.as_deref(),
                context.link_id.as_deref(),
            ) {
                tracing::warn!("Failed to persist active session: {}", e);
            }
        }

        Ok(format!("✅ Session started: {}\n{}", session_id, msg))
    }

    pub async fn checkpoint_for_root(
        &self,
        project_root: PathBuf,
        params: CheckpointParams,
    ) -> Result<String, String> {
        let file_changes = file_changes_from_input(params.files_changed);
        let file_count = file_changes.len();
        let filtered_summary = PiiFilter::filter_text(&params.summary);
        let context = self.request_context(params.agent_name.as_deref(), params.link_id.as_deref());

        if let Some(active) = self
            .active_session_ref_for_root(&project_root, &context)
            .await
        {
            let mut sessions = self.sessions.write().await;
            if let Some(state) = sessions.get_mut(&active.session_id) {
                state.file_changes.extend(file_changes.clone());
                if let Some(tokens) = params.estimated_tokens {
                    state.estimated_tokens += tokens;
                }
            }
        }

        let git_ref = crate::git::diff::get_current_git_ref_for_root(&project_root).ok();
        let payload = EventPayload {
            summary: Some(filtered_summary.clone()),
            git_ref,
            file_changes: Some(file_changes),
            tags: params.tags,
            estimated_tokens: params.estimated_tokens,
            ..Default::default()
        };

        let event = self
            .create_event_for_root(&project_root, EventType::Checkpoint, payload, &context)
            .await;
        let msg = self.record_event_for_root(&project_root, &event).await;
        Ok(format!(
            "💾 Checkpoint saved: {} files changed\n{}\n{}",
            file_count, filtered_summary, msg
        ))
    }

    pub async fn report_issue_for_root(
        &self,
        project_root: PathBuf,
        params: ReportIssueParams,
    ) -> Result<String, String> {
        let filtered_message = PiiFilter::filter_text(&params.error_message);
        let context = self.request_context(params.agent_name.as_deref(), params.link_id.as_deref());
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

        let event = self
            .create_event_for_root(&project_root, EventType::IssueReport, payload, &context)
            .await;
        let msg = self.record_event_for_root(&project_root, &event).await;
        Ok(format!("🐛 Issue reported: {}\n{}", filtered_message, msg))
    }

    pub async fn end_session_for_root(
        &self,
        project_root: PathBuf,
        params: EndSessionParams,
    ) -> Result<String, String> {
        let context = self.request_context(params.agent_name.as_deref(), params.link_id.as_deref());
        let active = self
            .active_session_ref_for_root(&project_root, &context)
            .await
            .ok_or_else(|| {
                format!(
                    "No active session to end for this project root and owner {}",
                    context.active_key
                )
            })?;
        let session_id = active.session_id;
        let active_owner_key = active.active_key.clone();

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

        let event = self
            .create_event_for_root(&project_root, EventType::SessionEnd, payload, &context)
            .await;
        let msg = self.record_event_for_root(&project_root, &event).await;

        {
            let mut active = self.active_sessions.write().await;
            active.remove(&active_session_key(&project_root, &active_owner_key));
        }
        if let Ok(store) = self.history_store_for_root(&project_root) {
            if let Err(e) = store.clear_active_session(Some(&active_owner_key)) {
                tracing::warn!("Failed to clear active session: {}", e);
            }
        }

        let (files, tokens) = session_stats.unwrap_or((0, 0));
        Ok(format!(
            "✅ Session {} ended\nFiles changed: {}, Tokens used: ~{}\n{}",
            session_id, files, tokens, msg
        ))
    }

    pub async fn fetch_past_context_for_root(
        &self,
        project_root: PathBuf,
        params: FetchContextParams,
    ) -> Result<String, String> {
        let store = self.history_store_for_root(&project_root)?;
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

    pub async fn list_sessions_for_root(
        &self,
        project_root: PathBuf,
        params: ListSessionsParams,
    ) -> Result<String, String> {
        let store = self.history_store_for_root(&project_root)?;
        let sessions = store
            .list_sessions(params.limit, params.status.as_deref())
            .map_err(|e| e.to_string())?;
        Ok(format_sessions("📚 Tarae Sessions", &sessions))
    }

    pub async fn read_session_for_root(
        &self,
        project_root: PathBuf,
        params: ReadSessionParams,
    ) -> Result<String, String> {
        let store = self.history_store_for_root(&project_root)?;
        match params.format.as_str() {
            "jsonl" => store
                .read_session_jsonl(&params.session_id)
                .map_err(|e| e.to_string()),
            _ => store
                .read_session_markdown(&params.session_id)
                .map_err(|e| e.to_string()),
        }
    }

    pub async fn search_history_for_root(
        &self,
        project_root: PathBuf,
        params: SearchHistoryParams,
    ) -> Result<String, String> {
        let store = self.history_store_for_root(&project_root)?;
        let hits = store
            .search_history(SearchCriteria {
                query: params.query,
                file_path: params.file_path,
                event_type: params.event_type,
                agent_name: params.agent_name,
                link_id: params.link_id,
                session_id: params.session_id,
                status: params.status,
                tag: params.tag,
                after: params.after,
                before: params.before,
                limit: params.limit,
                sort_desc: !params.sort.eq_ignore_ascii_case("asc"),
            })
            .map_err(|e| e.to_string())?;
        Ok(format_search_hits(&hits))
    }

    async fn active_session_count_for_root(&self, project_root: &Path) -> usize {
        self.active_session_refs_for_root(project_root).await.len()
    }

    async fn active_session_ref_for_root(
        &self,
        project_root: &Path,
        context: &RequestContext,
    ) -> Option<ActiveSessionRef> {
        let key = active_session_key(project_root, &context.active_key);
        if let Some(session_id) = self.active_sessions.read().await.get(&key).copied() {
            return Some(self.active_session_ref_from_memory(&key, session_id).await);
        }

        let store = self.history_store_for_root(project_root).ok()?;
        if let Some(record) = store
            .get_active_session_record(&context.active_key)
            .ok()
            .flatten()
        {
            return self
                .remember_active_session_record(project_root, record)
                .await;
        }

        if !context.explicit_identity {
            if let Some(record) = store.get_only_active_session_record().ok().flatten() {
                return self
                    .remember_active_session_record(project_root, record)
                    .await;
            }
        }

        None
    }

    async fn active_session_refs_for_root(&self, project_root: &Path) -> Vec<ActiveSessionRef> {
        let root = root_key(project_root);
        let mut refs_by_session = HashMap::<Uuid, ActiveSessionRef>::new();
        let memory_entries = self
            .active_sessions
            .read()
            .await
            .iter()
            .filter(|(key, _)| project_root_from_active_key(key).as_deref() == Some(root.as_str()))
            .map(|(key, session_id)| (key.clone(), *session_id))
            .collect::<Vec<_>>();

        for (key, session_id) in memory_entries {
            let active_ref = self.active_session_ref_from_memory(&key, session_id).await;
            refs_by_session.insert(active_ref.session_id, active_ref);
        }

        if let Some(records) = self
            .history_store_for_root(project_root)
            .ok()
            .and_then(|store| store.get_active_session_records().ok())
        {
            for record in records {
                if let Some(active_ref) = self
                    .remember_active_session_record(project_root, record)
                    .await
                {
                    refs_by_session.insert(active_ref.session_id, active_ref);
                }
            }
        }

        refs_by_session.into_values().collect()
    }

    async fn active_session_ref_from_memory(
        &self,
        active_key: &str,
        session_id: Uuid,
    ) -> ActiveSessionRef {
        let actor = self
            .sessions
            .read()
            .await
            .get(&session_id)
            .map(|state| state.actor.clone())
            .unwrap_or_else(|| Actor {
                actor_type: ActorType::AiAgent,
                agent_name: Some("mcp-client".to_string()),
                link_id: None,
            });
        ActiveSessionRef {
            session_id,
            active_key: owner_from_active_session_key(active_key).to_string(),
            actor,
        }
    }

    async fn remember_active_session_record(
        &self,
        project_root: &Path,
        record: ActiveSessionRecord,
    ) -> Option<ActiveSessionRef> {
        let session_id = Uuid::parse_str(&record.session_id).ok()?;
        let owner_key = record.active_key.clone().unwrap_or_else(|| {
            active_session_owner_key(record.agent_name.as_deref(), record.link_id.as_deref())
        });
        let key = active_session_key(project_root, &owner_key);
        let actor = Actor {
            actor_type: ActorType::AiAgent,
            agent_name: record.agent_name.clone(),
            link_id: record.link_id.clone(),
        };
        {
            let mut active = self.active_sessions.write().await;
            active.insert(key.clone(), session_id);
        }
        {
            let mut sessions = self.sessions.write().await;
            sessions.entry(session_id).or_insert_with(|| SessionState {
                session_id,
                project_root: root_key(project_root),
                objective: record.objective.clone(),
                actor: actor.clone(),
                file_changes: Vec::new(),
                tags: Vec::new(),
                estimated_tokens: 0,
            });
        }
        Some(ActiveSessionRef {
            session_id,
            active_key: owner_key,
            actor,
        })
    }
}

fn file_changes_from_input(input: Vec<FileChangeInput>) -> Vec<FileChange> {
    input
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
        .collect()
}

// -- Tool implementations --

#[tool_router]
impl TaraeServer {
    #[tool(description = "Start a new AI coding session. Call this when beginning work on a task.")]
    async fn start_session(
        &self,
        peer: Peer<RoleServer>,
        Parameters(params): Parameters<StartSessionParams>,
    ) -> Result<String, String> {
        let project_root = self
            .core
            .resolve_project_root_for_call(params.project_root.as_deref(), Some(&peer), false)
            .await?;
        self.core.start_session_for_root(project_root, params).await
    }

    #[tool(
        description = "Save a checkpoint of current progress. Call after completing a logical unit of work."
    )]
    async fn checkpoint(
        &self,
        peer: Peer<RoleServer>,
        Parameters(params): Parameters<CheckpointParams>,
    ) -> Result<String, String> {
        let project_root = self
            .core
            .resolve_project_root_for_call(params.project_root.as_deref(), Some(&peer), true)
            .await?;
        self.core.checkpoint_for_root(project_root, params).await
    }

    #[tool(description = "Report an error or issue encountered during development.")]
    async fn report_issue(
        &self,
        peer: Peer<RoleServer>,
        Parameters(params): Parameters<ReportIssueParams>,
    ) -> Result<String, String> {
        let project_root = self
            .core
            .resolve_project_root_for_call(params.project_root.as_deref(), Some(&peer), true)
            .await?;
        self.core.report_issue_for_root(project_root, params).await
    }

    #[tool(description = "End the current coding session.")]
    async fn end_session(
        &self,
        peer: Peer<RoleServer>,
        Parameters(params): Parameters<EndSessionParams>,
    ) -> Result<String, String> {
        let project_root = self
            .core
            .resolve_project_root_for_call(params.project_root.as_deref(), Some(&peer), true)
            .await?;
        self.core.end_session_for_root(project_root, params).await
    }

    #[tool(
        description = "Fetch past context and suggestions for the current project. Useful for getting an overview of recent work."
    )]
    async fn fetch_past_context(
        &self,
        peer: Peer<RoleServer>,
        Parameters(params): Parameters<FetchContextParams>,
    ) -> Result<String, String> {
        let project_root = self
            .core
            .resolve_project_root_for_call(params.project_root.as_deref(), Some(&peer), true)
            .await?;
        self.core
            .fetch_past_context_for_root(project_root, params)
            .await
    }

    #[tool(description = "List recent local Tarae sessions from .tarae/topa.")]
    async fn list_sessions(
        &self,
        peer: Peer<RoleServer>,
        Parameters(params): Parameters<ListSessionsParams>,
    ) -> Result<String, String> {
        let project_root = self
            .core
            .resolve_project_root_for_call(params.project_root.as_deref(), Some(&peer), true)
            .await?;
        self.core.list_sessions_for_root(project_root, params).await
    }

    #[tool(description = "Read a local Tarae session as markdown or jsonl.")]
    async fn read_session(
        &self,
        peer: Peer<RoleServer>,
        Parameters(params): Parameters<ReadSessionParams>,
    ) -> Result<String, String> {
        let project_root = self
            .core
            .resolve_project_root_for_call(params.project_root.as_deref(), Some(&peer), true)
            .await?;
        self.core.read_session_for_root(project_root, params).await
    }

    #[tool(
        description = "Search local Tarae history by query, file path, event type, agent, link id, tags, status, session id, and time range."
    )]
    async fn search_history(
        &self,
        peer: Peer<RoleServer>,
        Parameters(params): Parameters<SearchHistoryParams>,
    ) -> Result<String, String> {
        let project_root = self
            .core
            .resolve_project_root_for_call(params.project_root.as_deref(), Some(&peer), true)
            .await?;
        self.core
            .search_history_for_root(project_root, params)
            .await
    }
}

#[tool_router]
impl TaraeBridgeServer {
    #[tool(description = "Start a new AI coding session. Call this when beginning work on a task.")]
    async fn start_session(
        &self,
        peer: Peer<RoleServer>,
        Parameters(mut params): Parameters<StartSessionParams>,
    ) -> Result<String, String> {
        let project_root = self
            .resolve_project_root_for_call(params.project_root.as_deref(), Some(&peer), false)
            .await?;
        self.apply_agent_defaults(&mut params.agent_name, &mut params.link_id);
        params.project_root = Some(root_key(&project_root));
        let result = self
            .call_daemon(&project_root, "start_session", &params)
            .await?;
        self.remember_active_root(&project_root).await;
        Ok(result)
    }

    #[tool(
        description = "Save a checkpoint of current progress. Call after completing a logical unit of work."
    )]
    async fn checkpoint(
        &self,
        peer: Peer<RoleServer>,
        Parameters(mut params): Parameters<CheckpointParams>,
    ) -> Result<String, String> {
        let project_root = self
            .resolve_project_root_for_call(params.project_root.as_deref(), Some(&peer), true)
            .await?;
        self.apply_agent_defaults(&mut params.agent_name, &mut params.link_id);
        params.project_root = Some(root_key(&project_root));
        self.call_daemon(&project_root, "checkpoint", &params).await
    }

    #[tool(description = "Report an error or issue encountered during development.")]
    async fn report_issue(
        &self,
        peer: Peer<RoleServer>,
        Parameters(mut params): Parameters<ReportIssueParams>,
    ) -> Result<String, String> {
        let project_root = self
            .resolve_project_root_for_call(params.project_root.as_deref(), Some(&peer), true)
            .await?;
        self.apply_agent_defaults(&mut params.agent_name, &mut params.link_id);
        params.project_root = Some(root_key(&project_root));
        self.call_daemon(&project_root, "report_issue", &params)
            .await
    }

    #[tool(description = "End the current coding session.")]
    async fn end_session(
        &self,
        peer: Peer<RoleServer>,
        Parameters(mut params): Parameters<EndSessionParams>,
    ) -> Result<String, String> {
        let project_root = self
            .resolve_project_root_for_call(params.project_root.as_deref(), Some(&peer), true)
            .await?;
        self.apply_agent_defaults(&mut params.agent_name, &mut params.link_id);
        params.project_root = Some(root_key(&project_root));
        let result = self
            .call_daemon(&project_root, "end_session", &params)
            .await?;
        self.forget_active_root(&project_root).await;
        Ok(result)
    }

    #[tool(
        description = "Fetch past context and suggestions for the current project. Useful for getting an overview of recent work."
    )]
    async fn fetch_past_context(
        &self,
        peer: Peer<RoleServer>,
        Parameters(mut params): Parameters<FetchContextParams>,
    ) -> Result<String, String> {
        let project_root = self
            .resolve_project_root_for_call(params.project_root.as_deref(), Some(&peer), true)
            .await?;
        params.project_root = Some(root_key(&project_root));
        self.call_daemon(&project_root, "fetch_past_context", &params)
            .await
    }

    #[tool(description = "List recent local Tarae sessions from .tarae/topa.")]
    async fn list_sessions(
        &self,
        peer: Peer<RoleServer>,
        Parameters(mut params): Parameters<ListSessionsParams>,
    ) -> Result<String, String> {
        let project_root = self
            .resolve_project_root_for_call(params.project_root.as_deref(), Some(&peer), true)
            .await?;
        params.project_root = Some(root_key(&project_root));
        self.call_daemon(&project_root, "list_sessions", &params)
            .await
    }

    #[tool(description = "Read a local Tarae session as markdown or jsonl.")]
    async fn read_session(
        &self,
        peer: Peer<RoleServer>,
        Parameters(mut params): Parameters<ReadSessionParams>,
    ) -> Result<String, String> {
        let project_root = self
            .resolve_project_root_for_call(params.project_root.as_deref(), Some(&peer), true)
            .await?;
        params.project_root = Some(root_key(&project_root));
        self.call_daemon(&project_root, "read_session", &params)
            .await
    }

    #[tool(
        description = "Search local Tarae history by query, file path, event type, agent, link id, tags, status, session id, and time range."
    )]
    async fn search_history(
        &self,
        peer: Peer<RoleServer>,
        Parameters(mut params): Parameters<SearchHistoryParams>,
    ) -> Result<String, String> {
        let project_root = self
            .resolve_project_root_for_call(params.project_root.as_deref(), Some(&peer), true)
            .await?;
        params.project_root = Some(root_key(&project_root));
        self.call_daemon(&project_root, "search_history", &params)
            .await
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
        if session.agent_name.is_some() || session.link_id.is_some() {
            out.push_str("\n  Actor:");
            if let Some(agent_name) = &session.agent_name {
                out.push_str(&format!(" agent={agent_name}"));
            }
            if let Some(link_id) = &session.link_id {
                out.push_str(&format!(" link={link_id}"));
            }
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
        if hit.agent_name.is_some() || hit.link_id.is_some() || hit.status.is_some() {
            out.push_str("\n  Context:");
            if let Some(agent_name) = &hit.agent_name {
                out.push_str(&format!(" agent={agent_name}"));
            }
            if let Some(link_id) = &hit.link_id {
                out.push_str(&format!(" link={link_id}"));
            }
            if let Some(status) = &hit.status {
                out.push_str(&format!(" status={status}"));
            }
        }
        if !hit.files.is_empty() {
            out.push_str(&format!("\n  Files: {}", hit.files.join(", ")));
        }
        if let Some(snippet) = &hit.snippet {
            out.push_str(&format!("\n  Snippet: {snippet}"));
        }
        if !hit.matched_fields.is_empty() {
            out.push_str(&format!("\n  Matched: {}", hit.matched_fields.join(", ")));
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

#[tool_handler]
impl ServerHandler for TaraeBridgeServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::from_build_env())
            .with_instructions("Topa (톺아) — Tarae's stdio MCP bridge. Tool calls are forwarded to one project-scoped topa daemon that owns watching, history writes, and active session state. Use start_session to begin tracking, checkpoint to save progress, report_issue to log errors, end_session to close work, and list_sessions/read_session/search_history/fetch_past_context for local project history.")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn active_session_lookup_is_scoped_by_link_id() {
        let dir = TempDir::new().unwrap();
        let store = HistoryStore::open(dir.path()).unwrap();
        let codex_id = Uuid::new_v4();
        let gemini_id = Uuid::new_v4();
        store
            .set_active_session(
                &codex_id.to_string(),
                Some("backend"),
                Some("codex"),
                Some("codex-main"),
            )
            .unwrap();
        store
            .set_active_session(
                &gemini_id.to_string(),
                Some("qa"),
                Some("gemini"),
                Some("gemini-main"),
            )
            .unwrap();

        let core = TaraeCore::new(Arc::new(AppConfig::default()));
        let codex_context = core.request_context(Some("codex"), Some("codex-main"));
        let gemini_context = core.request_context(Some("gemini"), Some("gemini-main"));
        let default_context = core.request_context(None, None);

        assert_eq!(
            core.active_session_ref_for_root(dir.path(), &codex_context)
                .await
                .unwrap()
                .session_id,
            codex_id
        );
        let partial_memory_event = core
            .create_watcher_event_for_root(
                dir.path(),
                EventType::AutoCheckpoint,
                EventPayload::default(),
            )
            .await;
        assert_eq!(
            partial_memory_event.payload.attribution.unwrap().status,
            AttributionStatus::AmbiguousActiveSessions
        );

        assert_eq!(
            core.active_session_ref_for_root(dir.path(), &gemini_context)
                .await
                .unwrap()
                .session_id,
            gemini_id
        );
        assert!(core
            .active_session_ref_for_root(dir.path(), &default_context)
            .await
            .is_none());

        let event = core
            .create_watcher_event_for_root(
                dir.path(),
                EventType::AutoCheckpoint,
                EventPayload::default(),
            )
            .await;
        let attribution = event.payload.attribution.unwrap();
        assert_eq!(
            attribution.status,
            AttributionStatus::AmbiguousActiveSessions
        );
        assert_eq!(attribution.active_session_count, 2);
        assert!(event.session_id.is_none());
    }
}
