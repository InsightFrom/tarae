use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use crate::mcp::schema::FileChange;

/// Auto-checkpoint trigger based on accumulated file changes.
pub struct AutoCheckpoint {
    threshold: u32,
    change_counter: Arc<AtomicU32>,
    pending_changes: std::sync::Mutex<Vec<FileChange>>,
}

impl AutoCheckpoint {
    pub fn new(threshold: u32) -> Self {
        Self {
            threshold,
            change_counter: Arc::new(AtomicU32::new(0)),
            pending_changes: std::sync::Mutex::new(Vec::new()),
        }
    }

    /// Record file changes. Returns true if threshold is reached.
    pub fn record(&self, changes: &[FileChange]) -> bool {
        let count = self
            .change_counter
            .fetch_add(changes.len() as u32, Ordering::SeqCst);
        {
            let mut pending = self.pending_changes.lock().unwrap();
            pending.extend(changes.iter().cloned());
        }
        count + changes.len() as u32 >= self.threshold
    }

    /// Take all pending changes and reset counter.
    pub fn take_pending(&self) -> Vec<FileChange> {
        self.change_counter.store(0, Ordering::SeqCst);
        let mut pending = self.pending_changes.lock().unwrap();
        std::mem::take(&mut *pending)
    }

    /// Current count of accumulated changes.
    #[allow(dead_code)]
    pub fn current_count(&self) -> u32 {
        self.change_counter.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::schema::FileAction;

    fn make_changes(count: usize) -> Vec<FileChange> {
        (0..count)
            .map(|i| FileChange {
                path: format!("file_{}.rs", i),
                action: FileAction::Modified,
                lines_added: 10,
                lines_removed: 5,
            })
            .collect()
    }

    #[test]
    fn test_threshold_not_reached() {
        let ac = AutoCheckpoint::new(5);
        assert!(!ac.record(&make_changes(3)));
        assert_eq!(ac.current_count(), 3);
    }

    #[test]
    fn test_threshold_reached() {
        let ac = AutoCheckpoint::new(5);
        assert!(!ac.record(&make_changes(3)));
        assert!(ac.record(&make_changes(3))); // Total 6 >= 5
    }

    #[test]
    fn test_take_and_reset() {
        let ac = AutoCheckpoint::new(5);
        ac.record(&make_changes(3));
        let taken = ac.take_pending();
        assert_eq!(taken.len(), 3);
        assert_eq!(ac.current_count(), 0);
    }

    #[test]
    fn test_exact_threshold() {
        let ac = AutoCheckpoint::new(5);
        // Exactly 5 files with threshold 5 should trigger
        assert!(ac.record(&make_changes(5)));
    }

    #[test]
    fn test_multiple_take_pending() {
        let ac = AutoCheckpoint::new(5);
        ac.record(&make_changes(3));
        let first = ac.take_pending();
        assert_eq!(first.len(), 3);
        // Second take should return empty
        let second = ac.take_pending();
        assert_eq!(second.len(), 0);
    }

    #[test]
    fn test_counter_resets_after_take() {
        let ac = AutoCheckpoint::new(5);
        ac.record(&make_changes(3));
        ac.take_pending();
        // After reset, 3 changes should NOT trigger (threshold is 5)
        assert!(!ac.record(&make_changes(3)));
        assert_eq!(ac.current_count(), 3);
    }

    #[test]
    fn test_threshold_one() {
        let ac = AutoCheckpoint::new(1);
        // Threshold 1 should trigger on very first change
        assert!(ac.record(&make_changes(1)));
    }
}
