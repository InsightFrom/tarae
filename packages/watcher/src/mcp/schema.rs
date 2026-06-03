use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Top-level topa-event-v1 payload persisted by topa in local project history.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopaEvent {
    pub schema_version: String,
    pub event_id: Uuid,
    pub event_type: EventType,
    pub timestamp: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<Uuid>,
    pub actor: Actor,
    pub payload: EventPayload,
}
impl TopaEvent {
    pub fn new(event_type: EventType, actor: Actor, payload: EventPayload) -> Self {
        Self {
            schema_version: "topa-event-v1".to_string(),
            event_id: Uuid::new_v4(),
            event_type,
            timestamp: Utc::now(),
            session_id: None,
            actor,
            payload,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    SessionStart,
    Checkpoint,
    AutoCheckpoint,
    SessionEnd,
    IssueReport,
    HumanIntervention,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Actor {
    #[serde(rename = "type")]
    pub actor_type: ActorType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ActorType {
    AiAgent,
    Human,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EventPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub objective: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_ref: Option<GitRef>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_changes: Option<Vec<FileChange>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_tree: Option<serde_json::Value>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_context: Option<ErrorContext>,

    #[serde(default)]
    pub tags: Vec<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_tokens: Option<u32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub attribution: Option<Attribution>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attribution {
    pub status: AttributionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default)]
    pub active_session_count: usize,
    #[serde(default)]
    pub candidate_session_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AttributionStatus {
    Explicit,
    SingleActiveSession,
    AmbiguousActiveSessions,
    HeuristicAi,
    Human,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitRef {
    pub branch: String,
    pub commit_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    pub path: String,
    pub action: FileAction,
    #[serde(default)]
    pub lines_added: u32,
    #[serde(default)]
    pub lines_removed: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FileAction {
    Created,
    Modified,
    Deleted,
    Renamed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorContext {
    pub error_message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os_info: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_version: Option<String>,
    #[serde(default)]
    pub log_tail: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_serialize_checkpoint_event() {
        let event = TopaEvent::new(
            EventType::Checkpoint,
            Actor {
                actor_type: ActorType::AiAgent,
                agent_name: Some("cursor".to_string()),
                link_id: Some("cursor-default".to_string()),
            },
            EventPayload {
                summary: Some("Added JWT validation middleware".to_string()),
                git_ref: Some(GitRef {
                    branch: "main".to_string(),
                    commit_hash: "abc123".to_string(),
                    commit_message: None,
                }),
                file_changes: Some(vec![FileChange {
                    path: "src/auth.rs".to_string(),
                    action: FileAction::Modified,
                    lines_added: 42,
                    lines_removed: 10,
                }]),
                ..Default::default()
            },
        );

        let json = serde_json::to_string_pretty(&event).unwrap();
        assert!(json.contains("topa-event-v1"));
        assert!(json.contains("checkpoint"));

        // Verify round-trip
        let decoded: TopaEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded.event_type, EventType::Checkpoint);
    }

    #[test]
    fn test_serialize_all_event_types() {
        let types = vec![
            (EventType::SessionStart, "session_start"),
            (EventType::Checkpoint, "checkpoint"),
            (EventType::AutoCheckpoint, "auto_checkpoint"),
            (EventType::SessionEnd, "session_end"),
            (EventType::IssueReport, "issue_report"),
            (EventType::HumanIntervention, "human_intervention"),
        ];
        for (event_type, expected_str) in types {
            let json = serde_json::to_string(&event_type).unwrap();
            assert_eq!(json, format!("\"{}\"", expected_str));
        }
    }

    #[test]
    fn test_topa_event_new_sets_defaults() {
        let event = TopaEvent::new(
            EventType::SessionStart,
            Actor {
                actor_type: ActorType::AiAgent,
                agent_name: None,
                link_id: None,
            },
            EventPayload::default(),
        );
        assert_eq!(event.schema_version, "topa-event-v1");
        assert!(event.session_id.is_none());
    }

    #[test]
    fn test_event_payload_default() {
        let payload = EventPayload::default();
        assert!(payload.summary.is_none());
        assert!(payload.objective.is_none());
        assert!(payload.git_ref.is_none());
        assert!(payload.file_changes.is_none());
        assert!(payload.folder_tree.is_none());
        assert!(payload.error_context.is_none());
        assert!(payload.tags.is_empty());
        assert!(payload.estimated_tokens.is_none());
        assert!(payload.attribution.is_none());
    }

    #[test]
    fn test_serialize_human_intervention_roundtrip() {
        let event = TopaEvent::new(
            EventType::HumanIntervention,
            Actor {
                actor_type: ActorType::Human,
                agent_name: None,
                link_id: None,
            },
            EventPayload {
                summary: Some("Human coding activity detected".to_string()),
                file_changes: Some(vec![FileChange {
                    path: "src/lib.rs".to_string(),
                    action: FileAction::Created,
                    lines_added: 5,
                    lines_removed: 0,
                }]),
                ..Default::default()
            },
        );

        let json = serde_json::to_string(&event).unwrap();
        let decoded: TopaEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded.event_type, EventType::HumanIntervention);
        assert_eq!(decoded.actor.actor_type, ActorType::Human);
        assert!(decoded.actor.agent_name.is_none());
    }

    #[test]
    fn test_skip_serializing_none_fields() {
        let event = TopaEvent::new(
            EventType::Checkpoint,
            Actor {
                actor_type: ActorType::AiAgent,
                agent_name: None,
                link_id: None,
            },
            EventPayload::default(),
        );
        let json = serde_json::to_string(&event).unwrap();
        // None fields should be omitted
        assert!(!json.contains("session_id"));
        assert!(!json.contains("agent_name"));
        assert!(!json.contains("link_id"));
        assert!(!json.contains("attribution"));
        assert!(!json.contains("summary"));
        assert!(!json.contains("objective"));
        assert!(!json.contains("git_ref"));
        assert!(!json.contains("file_changes"));
    }

    #[test]
    fn test_actor_type_serialization() {
        assert_eq!(
            serde_json::to_string(&ActorType::AiAgent).unwrap(),
            "\"ai_agent\""
        );
        assert_eq!(
            serde_json::to_string(&ActorType::Human).unwrap(),
            "\"human\""
        );
    }

    #[test]
    fn test_file_action_serialization() {
        assert_eq!(
            serde_json::to_string(&FileAction::Created).unwrap(),
            "\"created\""
        );
        assert_eq!(
            serde_json::to_string(&FileAction::Modified).unwrap(),
            "\"modified\""
        );
        assert_eq!(
            serde_json::to_string(&FileAction::Deleted).unwrap(),
            "\"deleted\""
        );
        assert_eq!(
            serde_json::to_string(&FileAction::Renamed).unwrap(),
            "\"renamed\""
        );
    }
}
