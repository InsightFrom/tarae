use std::time::{Duration, Instant};

/// State machine for detecting AI vs Human activity patterns.
///
/// Heuristics:
/// - Rapid, large batch changes → AI agent
/// - Slow, single-file changes → Human
/// - Periods of inactivity followed by burst → AI agent
#[derive(Debug, Clone, PartialEq)]
pub enum ActivityState {
    /// Idle — no recent file changes
    Idle,
    /// AI agent is actively working (rapid changes)
    AiActive {
        started_at: Instant,
        change_count: u32,
    },
    /// Human is editing (slow, deliberate changes)
    HumanActive {
        started_at: Instant,
        change_count: u32,
    },
}

pub struct StateMachine {
    state: ActivityState,
    last_change_at: Option<Instant>,
    change_buffer: Vec<ChangeRecord>,
}

struct ChangeRecord {
    timestamp: Instant,
    file_count: usize,
}

impl StateMachine {
    pub fn new() -> Self {
        Self {
            state: ActivityState::Idle,
            last_change_at: None,
            change_buffer: Vec::new(),
        }
    }

    /// Record a batch of file changes and update the state.
    pub fn record_changes(&mut self, file_count: usize) -> ActivityState {
        let now = Instant::now();

        self.change_buffer.push(ChangeRecord {
            timestamp: now,
            file_count,
        });

        // Keep only recent records (last 30 seconds)
        self.change_buffer
            .retain(|r| now.duration_since(r.timestamp) < Duration::from_secs(30));

        let recent_changes: usize = self.change_buffer.iter().map(|r| r.file_count).sum();
        let change_frequency = self.change_buffer.len();

        // Determine new state based on heuristics
        let time_since_last = self
            .last_change_at
            .map(|t| now.duration_since(t))
            .unwrap_or(Duration::from_secs(999));

        self.state = if time_since_last > Duration::from_secs(60) {
            // Long gap — new activity burst
            if file_count > 3 || recent_changes > 5 {
                ActivityState::AiActive {
                    started_at: now,
                    change_count: recent_changes as u32,
                }
            } else {
                ActivityState::HumanActive {
                    started_at: now,
                    change_count: recent_changes as u32,
                }
            }
        } else if change_frequency > 5 && recent_changes > 10 {
            // High frequency, many files → AI
            ActivityState::AiActive {
                started_at: match &self.state {
                    ActivityState::AiActive { started_at, .. } => *started_at,
                    _ => now,
                },
                change_count: recent_changes as u32,
            }
        } else if change_frequency <= 3 && file_count <= 2 {
            // Low frequency, few files → Human
            ActivityState::HumanActive {
                started_at: match &self.state {
                    ActivityState::HumanActive { started_at, .. } => *started_at,
                    _ => now,
                },
                change_count: recent_changes as u32,
            }
        } else {
            // Ambiguous — keep current state
            self.state.clone()
        };

        self.last_change_at = Some(now);
        self.state.clone()
    }

    #[allow(dead_code)]
    pub fn current_state(&self) -> &ActivityState {
        &self.state
    }

    pub fn is_ai_active(&self) -> bool {
        matches!(self.state, ActivityState::AiActive { .. })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initial_state() {
        let sm = StateMachine::new();
        assert_eq!(*sm.current_state(), ActivityState::Idle);
    }

    #[test]
    fn test_ai_detection() {
        let mut sm = StateMachine::new();
        // Simulate rapid batch changes (AI pattern)
        for _ in 0..6 {
            sm.record_changes(5);
        }
        assert!(sm.is_ai_active());
    }

    #[test]
    fn test_human_detection() {
        let mut sm = StateMachine::new();
        // Single slow edit
        sm.record_changes(1);
        assert!(matches!(
            *sm.current_state(),
            ActivityState::HumanActive { .. }
        ));
    }

    #[test]
    fn test_is_ai_active_false_when_human() {
        let mut sm = StateMachine::new();
        sm.record_changes(1);
        assert!(!sm.is_ai_active());
    }

    #[test]
    fn test_is_ai_active_false_when_idle() {
        let sm = StateMachine::new();
        assert!(!sm.is_ai_active());
    }

    #[test]
    fn test_large_batch_after_gap_is_ai() {
        let mut sm = StateMachine::new();
        // First call after fresh start = large gap (>60s by default)
        // Large batch (>3 files) should be detected as AI
        let state = sm.record_changes(5);
        assert!(matches!(state, ActivityState::AiActive { .. }));
        assert!(sm.is_ai_active());
    }

    #[test]
    fn test_small_edit_after_gap_is_human() {
        let mut sm = StateMachine::new();
        // Small edit (1 file) after gap → Human
        let state = sm.record_changes(1);
        assert!(matches!(state, ActivityState::HumanActive { .. }));
    }

    #[test]
    fn test_record_changes_returns_current_state() {
        let mut sm = StateMachine::new();
        let returned = sm.record_changes(1);
        assert_eq!(returned, *sm.current_state());
    }

    #[test]
    fn test_high_frequency_many_files_is_ai() {
        let mut sm = StateMachine::new();
        // First call to establish baseline (gap is large, 1 file → human)
        sm.record_changes(1);
        // Now rapid successive changes (>5 events, >10 total files)
        for _ in 0..6 {
            sm.record_changes(3);
        }
        assert!(sm.is_ai_active());
    }
}
