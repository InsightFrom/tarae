use anyhow::Result;

use crate::mcp::schema::GitRef;

/// Get the current git branch and HEAD commit hash.
pub fn get_current_git_ref() -> Result<GitRef> {
    let repo = git2::Repository::discover(".")?;

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
