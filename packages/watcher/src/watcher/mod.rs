pub mod auto_checkpoint;
pub mod file_watcher;
pub mod root;
pub mod state_machine;
pub mod taraeignore;

use std::time::Duration;
use tokio::time::sleep;
use tracing::{debug, info, warn};

use crate::mcp::schema::{Actor, ActorType, EventPayload, EventType};
use crate::mcp::tools::TaraeServer;
use crate::watcher::auto_checkpoint::AutoCheckpoint;
use crate::watcher::state_machine::StateMachine;

pub fn start_background_watcher_for_root(server: TaraeServer, project_root: std::path::PathBuf) {
    tokio::spawn(async move {
        start_background_watcher_loop(server, project_root).await;
    });
}

async fn start_background_watcher_loop(server: TaraeServer, project_root: std::path::PathBuf) {
    info!(path = %project_root.display(), "Initializing background file watcher");

    // 2. Start file watching
    let mut handle = match file_watcher::start_watching(&project_root) {
        Ok(h) => h,
        Err(e) => {
            warn!("Failed to start file watcher: {}", e);
            return;
        }
    };

    // 3. Initialize state machine and auto checkpoint
    let mut state_machine = StateMachine::new();
    let auto_checkpoint = AutoCheckpoint::new(server.config.auto_checkpoint_threshold);
    let mut pending_human_changes = Vec::new();
    let mut debounce_timer: Option<std::pin::Pin<Box<tokio::time::Sleep>>> = None;

    // Rate limiter state
    let mut event_count = 0;
    let mut last_reset = tokio::time::Instant::now();
    const MAX_EVENTS_PER_MIN: usize = 300;

    loop {
        let has_timer = debounce_timer.is_some();
        // Create a pin-able future for the timer to avoid dynamic recreation on poll cycles
        let timer_fut = async {
            if let Some(ref mut sleep_fut) = debounce_timer {
                sleep_fut.await;
            } else {
                std::future::pending::<()>().await;
            }
        };
        tokio::pin!(timer_fut);

        tokio::select! {
            // Receive file changes from watcher
            res = handle.rx.recv() => {
                match res {
                    Some(changes) => {
                        if changes.is_empty() {
                            continue;
                        }

                        // Rate limit check
                        let now = tokio::time::Instant::now();
                        if now.duration_since(last_reset).as_secs() >= 60 {
                            event_count = 0;
                            last_reset = now;
                        }

                        event_count += 1;
                        if event_count > MAX_EVENTS_PER_MIN {
                            if event_count == MAX_EVENTS_PER_MIN + 1 {
                                warn!("Watcher rate limit exceeded (>{} events/min). Dropping events to prevent infinite loops.", MAX_EVENTS_PER_MIN);
                            }
                            continue;
                        }

                        // Record changes in state machine
                        state_machine.record_changes(changes.len());

                        let is_mcp_active = server.is_active_session_running_for_root(&project_root).await;
                        let is_ai_active = is_mcp_active || state_machine.is_ai_active();

                        if is_ai_active {
                            debug!("AI activity pattern detected, recording to auto-checkpoint");
                            if auto_checkpoint.record(&changes) {
                                // Threshold reached!
                                let taken = auto_checkpoint.take_pending();
                                info!(files = taken.len(), "Auto-checkpoint threshold reached, sending event");

                                let git_ref = crate::git::diff::get_current_git_ref().ok();
                                let payload = EventPayload {
                                    summary: Some(auto_checkpoint_summary(
                                        &server.config.summary_language,
                                    )),
                                    file_changes: Some(taken),
                                    git_ref,
                                    ..Default::default()
                                };

                                let event = server.create_event_for_root(&project_root, EventType::AutoCheckpoint, payload).await;
                                let msg = server.record_event_for_root(&project_root, &event).await;
                                debug!("AutoCheckpoint record result: {}", msg);
                            }
                        } else {
                            debug!("Human activity pattern detected, queuing for debounce");
                            pending_human_changes.extend(changes);
                            // Set or reset the 5-second debounce timer
                            debounce_timer = Some(Box::pin(sleep(Duration::from_secs(5))));
                        }
                    }
                    None => {
                        warn!("File watcher receiver channel closed");
                        break;
                    }
                }
            }
            // Debounce timer expired
            _ = &mut timer_fut, if has_timer => {
                // Send HumanIntervention event
                debounce_timer = None;
                if !pending_human_changes.is_empty() {
                    let taken = std::mem::take(&mut pending_human_changes);
                    info!(files = taken.len(), "5s debounce elapsed, sending HumanIntervention event");

                    let git_ref = crate::git::diff::get_current_git_ref().ok();
                    let payload = EventPayload {
                        summary: Some(human_intervention_summary(
                            &server.config.summary_language,
                            state_machine.is_ai_active(),
                        )),
                        file_changes: Some(taken),
                        git_ref,
                        ..Default::default()
                    };

                    let mut event = server.create_event_for_root(&project_root, EventType::HumanIntervention, payload).await;
                    event.actor = Actor {
                        actor_type: ActorType::Human,
                        agent_name: None,
                    };

                    let msg = server.record_event_for_root(&project_root, &event).await;
                    debug!("HumanIntervention record result: {}", msg);
                }
            }
        }
    }
}

fn wants_korean(language: &str) -> bool {
    language.to_ascii_lowercase().starts_with("ko")
}

fn auto_checkpoint_summary(language: &str) -> String {
    if wants_korean(language) {
        "Tarae watcher 자동 체크포인트".to_string()
    } else {
        "Auto-checkpoint by Tarae watcher".to_string()
    }
}

fn human_intervention_summary(language: &str, heuristic_ai: bool) -> String {
    if wants_korean(language) {
        format!("사용자 작업 감지 (AI 추정={heuristic_ai})")
    } else {
        format!(
            "Human coding activity detected (session_active=false, heuristic_ai={heuristic_ai})"
        )
    }
}
