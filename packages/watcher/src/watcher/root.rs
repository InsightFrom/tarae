use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};

const WORKSPACE_MARKERS: &[&str] = &[
    ".taraeignore",
    "pnpm-workspace.yaml",
    "package.json",
    "Cargo.toml",
    "pyproject.toml",
    "go.mod",
];

/// Resolve the only directory topa is allowed to watch.
///
/// Explicit configuration wins. Without it, topa only starts the watcher when
/// the process cwd can be tied to a project root. This prevents MCP clients
/// launched from app support or home directories from recursively watching
/// unrelated user/system files.
pub fn resolve_project_root(config_root: Option<&str>) -> Result<Option<PathBuf>> {
    let cwd = std::env::current_dir().context("failed to read current working directory")?;
    let home = dirs::home_dir();
    resolve_project_root_from(config_root, &cwd, home.as_deref())
}

pub(crate) fn resolve_project_root_from(
    config_root: Option<&str>,
    cwd: &Path,
    home: Option<&Path>,
) -> Result<Option<PathBuf>> {
    let cwd = canonicalize_existing(cwd)?;

    if let Some(root) = config_root.map(str::trim).filter(|root| !root.is_empty()) {
        let expanded = expand_home(root, home);
        let candidate = if expanded.is_absolute() {
            expanded
        } else {
            cwd.join(expanded)
        };
        let root = canonicalize_existing(&candidate)
            .with_context(|| format!("invalid TARAE_PROJECT_ROOT: {}", candidate.display()))?;
        validate_watch_root(&root, home)?;
        return Ok(Some(root));
    }

    if let Some(root) = discover_git_root(&cwd)? {
        validate_watch_root(&root, home)?;
        return Ok(Some(root));
    }

    if let Some(root) = discover_marker_root(&cwd)? {
        validate_watch_root(&root, home)?;
        return Ok(Some(root));
    }

    Ok(None)
}

fn expand_home(path: &str, home: Option<&Path>) -> PathBuf {
    if path == "~" {
        return home
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from(path));
    }

    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = home {
            return home.join(rest);
        }
    }

    PathBuf::from(path)
}

fn canonicalize_existing(path: &Path) -> Result<PathBuf> {
    path.canonicalize()
        .with_context(|| format!("failed to canonicalize {}", path.display()))
}

fn discover_git_root(cwd: &Path) -> Result<Option<PathBuf>> {
    match git2::Repository::discover(cwd) {
        Ok(repo) => {
            let root = repo
                .workdir()
                .map(Path::to_path_buf)
                .or_else(|| repo.path().parent().map(Path::to_path_buf));
            root.map(|path| canonicalize_existing(&path)).transpose()
        }
        Err(_) => Ok(None),
    }
}

fn discover_marker_root(cwd: &Path) -> Result<Option<PathBuf>> {
    for ancestor in cwd.ancestors() {
        if WORKSPACE_MARKERS
            .iter()
            .any(|marker| ancestor.join(marker).exists())
        {
            return canonicalize_existing(ancestor).map(Some);
        }
    }

    Ok(None)
}

fn validate_watch_root(root: &Path, home: Option<&Path>) -> Result<()> {
    if !root.is_dir() {
        bail!("watch root is not a directory: {}", root.display());
    }

    if is_high_risk_watch_root(root, home) {
        bail!(
            "refusing to watch high-risk non-project directory: {}",
            root.display()
        );
    }

    Ok(())
}

fn is_high_risk_watch_root(root: &Path, home: Option<&Path>) -> bool {
    if root.parent().is_none() {
        return true;
    }

    if let Some(home) = home.and_then(|path| path.canonicalize().ok()) {
        if root == home {
            return true;
        }

        if root.starts_with(home.join("Library")) {
            return true;
        }
    }

    let forbidden_exact = [
        "/", "/Users", "/private", "/tmp", "/var", "/usr", "/bin", "/sbin",
    ];
    if forbidden_exact.iter().any(|path| root == Path::new(path)) {
        return true;
    }

    ["/Applications", "/Library", "/System"]
        .iter()
        .any(|path| root.starts_with(Path::new(path)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn explicit_project_root_is_allowed() {
        let dir = TempDir::new().unwrap();
        let root = resolve_project_root_from(Some(dir.path().to_str().unwrap()), dir.path(), None)
            .unwrap()
            .unwrap();

        assert_eq!(root, dir.path().canonicalize().unwrap());
    }

    #[test]
    fn explicit_home_root_is_rejected() {
        let home = TempDir::new().unwrap();
        let err = resolve_project_root_from(
            Some(home.path().to_str().unwrap()),
            home.path(),
            Some(home.path()),
        )
        .unwrap_err();

        assert!(err.to_string().contains("high-risk"));
    }

    #[test]
    fn explicit_home_library_root_is_rejected() {
        let home = TempDir::new().unwrap();
        let app_support = home.path().join("Library/Application Support/Codex");
        fs::create_dir_all(&app_support).unwrap();

        let err = resolve_project_root_from(
            Some(app_support.to_str().unwrap()),
            home.path(),
            Some(home.path()),
        )
        .unwrap_err();

        assert!(err.to_string().contains("high-risk"));
    }

    #[test]
    fn implicit_git_root_is_discovered_from_subdirectory() {
        let dir = TempDir::new().unwrap();
        git2::Repository::init(dir.path()).unwrap();
        let nested = dir.path().join("packages/watcher/src");
        fs::create_dir_all(&nested).unwrap();

        let root = resolve_project_root_from(None, &nested, None)
            .unwrap()
            .unwrap();

        assert_eq!(root, dir.path().canonicalize().unwrap());
    }

    #[test]
    fn implicit_non_project_directory_disables_watcher() {
        let dir = TempDir::new().unwrap();
        let root = resolve_project_root_from(None, dir.path(), None).unwrap();

        assert!(root.is_none());
    }
}
