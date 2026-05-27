use anyhow::Result;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::mpsc;

use crate::mcp::schema::{FileAction, FileChange};
use crate::watcher::taraeignore::TaraeIgnore;

/// File system watcher that monitors project directory for changes.
pub struct FileWatcherHandle {
    _watcher: RecommendedWatcher,
    pub rx: mpsc::Receiver<Vec<FileChange>>,
}

/// Start watching a directory for file changes.
/// Returns a handle with a channel receiver for change events.
pub fn start_watching(root: &Path) -> Result<FileWatcherHandle> {
    let (tx, rx) = mpsc::channel::<Vec<FileChange>>(256);
    let root = root.canonicalize()?;
    let ignore = Arc::new(TaraeIgnore::load(&root));
    let root_path = root.clone();

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| match res {
            Ok(event) => {
                let changes = process_event(&event, &root_path, &ignore);
                if !changes.is_empty() {
                    let _ = tx.blocking_send(changes);
                }
            }
            Err(e) => tracing::warn!("Watch error: {}", e),
        },
        Config::default(),
    )?;

    watcher.watch(&root, RecursiveMode::Recursive)?;
    tracing::info!(path = %root.display(), "File watcher started");

    Ok(FileWatcherHandle {
        _watcher: watcher,
        rx,
    })
}

fn process_event(event: &Event, root: &Path, ignore: &TaraeIgnore) -> Vec<FileChange> {
    let action = match event.kind {
        EventKind::Create(_) => FileAction::Created,
        EventKind::Modify(_) => FileAction::Modified,
        EventKind::Remove(_) => FileAction::Deleted,
        _ => return Vec::new(),
    };

    let mut changes: Vec<FileChange> = event
        .paths
        .iter()
        .filter_map(|path| {
            // Get relative path
            if path.is_absolute() && !path.starts_with(root) {
                tracing::warn!(
                    path = %path.display(),
                    root = %root.display(),
                    "Dropping file watcher event outside project root"
                );
                return None;
            }

            let rel = path.strip_prefix(root).ok()?;
            let rel_str = rel.to_string_lossy().to_string();

            // Skip ignored files
            if ignore.is_ignored(&rel_str) {
                return None;
            }

            // Skip directories
            if path.is_dir() {
                return None;
            }

            Some(FileChange {
                path: rel_str,
                action: action.clone(),
                lines_added: 0, // Will be enriched by git diff
                lines_removed: 0,
            })
        })
        .collect();

    if changes.len() > 50 {
        tracing::warn!(
            "Too many files changed in a single event ({}), truncating to 50",
            changes.len()
        );
        changes.truncate(50);
    }
    changes
}
