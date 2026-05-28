use anyhow::Result;
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use crate::mcp::schema::{FileAction, FileChange, GitRef};

/// Get the current git branch and HEAD commit hash.
#[allow(dead_code)]
pub fn get_current_git_ref() -> Result<GitRef> {
    get_current_git_ref_for_root(Path::new("."))
}

/// Get the current git branch and HEAD commit hash for a project root.
pub fn get_current_git_ref_for_root(project_root: &Path) -> Result<GitRef> {
    let repo = git2::Repository::discover(project_root)?;

    let head = repo.head()?;
    let branch = head.shorthand().unwrap_or("HEAD").to_string();

    let commit = head.peel_to_commit()?;
    let commit_hash = commit.id().to_string();
    let commit_message = commit.message().map(|m| m.trim().to_string());

    Ok(GitRef {
        branch,
        commit_hash,
        commit_message,
    })
}

#[derive(Debug, Default, Clone)]
struct DiffStat {
    action: Option<FileAction>,
    lines_added: u32,
    lines_removed: u32,
}

/// Deduplicate watcher file events and enrich them with git diff line counts.
pub fn enrich_file_changes_with_diff_stats(
    project_root: &Path,
    changes: Vec<FileChange>,
) -> Vec<FileChange> {
    let mut merged: BTreeMap<String, FileChange> = BTreeMap::new();
    for change in changes {
        merged
            .entry(change.path.clone())
            .and_modify(|existing| {
                existing.action = merge_file_actions(&existing.action, &change.action);
            })
            .or_insert(change);
    }

    let Ok(stats) = diff_stats_for_changes(project_root, merged.keys()) else {
        return merged.into_values().collect();
    };

    merged
        .into_values()
        .map(|mut change| {
            if let Some(stat) = stats.get(&change.path) {
                if let Some(action) = &stat.action {
                    change.action = action.clone();
                }
                change.lines_added = stat.lines_added;
                change.lines_removed = stat.lines_removed;
            }
            if matches!(change.action, FileAction::Created) && change.lines_added == 0 {
                if let Some(lines_added) = count_file_lines(project_root, &change.path) {
                    change.lines_added = lines_added;
                }
            }
            change
        })
        .collect()
}

fn merge_file_actions(existing: &FileAction, next: &FileAction) -> FileAction {
    match (existing, next) {
        (_, FileAction::Deleted) | (FileAction::Deleted, _) => FileAction::Deleted,
        (_, FileAction::Renamed) | (FileAction::Renamed, _) => FileAction::Renamed,
        (FileAction::Created, _) | (_, FileAction::Created) => FileAction::Created,
        _ => FileAction::Modified,
    }
}

fn diff_stats_for_changes<'a>(
    project_root: &Path,
    project_paths: impl Iterator<Item = &'a String>,
) -> Result<BTreeMap<String, DiffStat>> {
    let repo = git2::Repository::discover(project_root)?;
    let Some(workdir) = repo.workdir() else {
        return Ok(BTreeMap::new());
    };

    let project_root = project_root
        .canonicalize()
        .unwrap_or_else(|_| project_root.to_path_buf());
    let workdir = workdir
        .canonicalize()
        .unwrap_or_else(|_| workdir.to_path_buf());
    let path_map = repo_path_map(&project_root, &workdir, project_paths);
    if path_map.is_empty() {
        return Ok(BTreeMap::new());
    }

    let mut opts = git2::DiffOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_unmodified(false);
    for repo_path in path_map.keys() {
        opts.pathspec(repo_path);
    }

    let head_tree = repo.head().ok().and_then(|head| head.peel_to_tree().ok());
    let diff = if let Some(tree) = &head_tree {
        repo.diff_tree_to_workdir_with_index(Some(tree), Some(&mut opts))?
    } else {
        repo.diff_index_to_workdir(None, Some(&mut opts))?
    };

    let stats: RefCell<BTreeMap<String, DiffStat>> = RefCell::new(BTreeMap::new());
    diff.foreach(
        &mut |delta, _| {
            if let Some(project_path) = delta_project_path(&delta, &path_map) {
                let mut stats = stats.borrow_mut();
                let stat = stats.entry(project_path).or_default();
                stat.action = Some(file_action_from_delta(delta.status()));
            }
            true
        },
        None,
        None,
        Some(&mut |delta, _hunk, line| {
            if let Some(project_path) = delta_project_path(&delta, &path_map) {
                let mut stats = stats.borrow_mut();
                let stat = stats.entry(project_path).or_default();
                match line.origin() {
                    '+' => stat.lines_added += 1,
                    '-' => stat.lines_removed += 1,
                    _ => {}
                }
            }
            true
        }),
    )?;

    Ok(stats.into_inner())
}

fn repo_path_map<'a>(
    project_root: &Path,
    workdir: &Path,
    project_paths: impl Iterator<Item = &'a String>,
) -> BTreeMap<String, String> {
    let mut seen = BTreeSet::new();
    let mut map = BTreeMap::new();

    for project_path in project_paths {
        if !seen.insert(project_path.clone()) {
            continue;
        }

        let absolute = project_root.join(project_path);
        let repo_path = absolute
            .strip_prefix(workdir)
            .map(normalize_git_path)
            .unwrap_or_else(|_| project_path.replace('\\', "/"));
        map.insert(repo_path, project_path.clone());
    }

    map
}

fn delta_project_path(
    delta: &git2::DiffDelta<'_>,
    path_map: &BTreeMap<String, String>,
) -> Option<String> {
    let repo_path = delta_repo_path(delta)?;
    path_map.get(&repo_path).cloned()
}

fn delta_repo_path(delta: &git2::DiffDelta<'_>) -> Option<String> {
    let path = match delta.status() {
        git2::Delta::Deleted => delta.old_file().path(),
        _ => delta.new_file().path().or_else(|| delta.old_file().path()),
    }?;
    Some(normalize_git_path(path))
}

fn normalize_git_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn file_action_from_delta(delta: git2::Delta) -> FileAction {
    match delta {
        git2::Delta::Added | git2::Delta::Untracked => FileAction::Created,
        git2::Delta::Deleted => FileAction::Deleted,
        git2::Delta::Renamed | git2::Delta::Copied => FileAction::Renamed,
        _ => FileAction::Modified,
    }
}

fn count_file_lines(project_root: &Path, relative_path: &str) -> Option<u32> {
    let content = fs::read_to_string(project_root.join(relative_path)).ok()?;
    Some(content.lines().count().min(u32::MAX as usize) as u32)
}

/// Get the list of changed files since a given commit hash.
#[allow(dead_code)]
pub fn get_changed_files_since(commit_hash: &str) -> Result<Vec<(String, String)>> {
    let repo = git2::Repository::discover(".")?;
    let old_oid = git2::Oid::from_str(commit_hash)?;
    let old_commit = repo.find_commit(old_oid)?;
    let old_tree = old_commit.tree()?;

    let head = repo.head()?.peel_to_commit()?.tree()?;

    let diff = repo.diff_tree_to_tree(Some(&old_tree), Some(&head), None)?;
    let mut files = Vec::new();

    diff.foreach(
        &mut |delta, _| {
            let path = delta
                .new_file()
                .path()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let action = match delta.status() {
                git2::Delta::Added => "created",
                git2::Delta::Deleted => "deleted",
                git2::Delta::Modified => "modified",
                git2::Delta::Renamed => "renamed",
                _ => "modified",
            };
            files.push((path, action.to_string()));
            true
        },
        None,
        None,
        None,
    )?;

    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn enrich_file_changes_uses_git_diff_line_stats_and_dedupes() {
        let dir = tempdir().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();
        fs::write(dir.path().join("tracked.txt"), "one\n").unwrap();
        commit_all(&repo, "initial");

        fs::write(dir.path().join("tracked.txt"), "one\ntwo\nthree\n").unwrap();

        let changes = vec![
            FileChange {
                path: "tracked.txt".to_string(),
                action: FileAction::Modified,
                lines_added: 0,
                lines_removed: 0,
            },
            FileChange {
                path: "tracked.txt".to_string(),
                action: FileAction::Modified,
                lines_added: 0,
                lines_removed: 0,
            },
        ];

        let enriched = enrich_file_changes_with_diff_stats(dir.path(), changes);
        assert_eq!(enriched.len(), 1);
        assert_eq!(enriched[0].path, "tracked.txt");
        assert_eq!(enriched[0].action, FileAction::Modified);
        assert_eq!(enriched[0].lines_added, 2);
        assert_eq!(enriched[0].lines_removed, 0);
    }

    #[test]
    fn enrich_file_changes_counts_untracked_files_as_created() {
        let dir = tempdir().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();
        fs::write(dir.path().join("README.md"), "root\n").unwrap();
        commit_all(&repo, "initial");

        fs::write(dir.path().join("new.txt"), "one\ntwo\n").unwrap();

        let enriched = enrich_file_changes_with_diff_stats(
            dir.path(),
            vec![FileChange {
                path: "new.txt".to_string(),
                action: FileAction::Modified,
                lines_added: 0,
                lines_removed: 0,
            }],
        );

        assert_eq!(enriched.len(), 1);
        assert_eq!(enriched[0].action, FileAction::Created);
        assert_eq!(enriched[0].lines_added, 2);
        assert_eq!(enriched[0].lines_removed, 0);
    }

    fn commit_all(repo: &git2::Repository, message: &str) {
        let mut index = repo.index().unwrap();
        index
            .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
            .unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = git2::Signature::now("Tarae Test", "tarae@example.com").unwrap();
        let parents = repo
            .head()
            .ok()
            .and_then(|head| head.peel_to_commit().ok())
            .into_iter()
            .collect::<Vec<_>>();
        let parent_refs = parents.iter().collect::<Vec<_>>();
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)
            .unwrap();
    }
}
