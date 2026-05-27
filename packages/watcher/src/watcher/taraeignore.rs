use glob::Pattern;
use std::path::Path;

/// Parser for .taraeignore files (similar to .gitignore).
pub struct TaraeIgnore {
    patterns: Vec<Pattern>,
}

/// Default patterns that are always ignored.
const DEFAULT_IGNORES: &[&str] = &[
    "node_modules/**",
    "**/node_modules/**",
    ".git/**",
    "**/.git/**",
    ".gemini/**",
    "**/.gemini/**",
    "Library/**",
    "**/Library/**",
    ".cache/**",
    "**/.cache/**",
    "cache/**",
    "**/cache/**",
    ".ruff_cache/**",
    "**/.ruff_cache/**",
    ".pytest_cache/**",
    "**/.pytest_cache/**",
    ".mypy_cache/**",
    "**/.mypy_cache/**",
    ".uv-cache/**",
    "**/.uv-cache/**",
    ".turbo/**",
    "**/.turbo/**",
    ".parcel-cache/**",
    "**/.parcel-cache/**",
    ".vite/**",
    "**/.vite/**",
    ".wrangler/**",
    "**/.wrangler/**",
    ".vercel/**",
    "**/.vercel/**",
    ".pnpm-store/**",
    "**/.pnpm-store/**",
    ".Trash/**",
    "**/.Trash/**",
    "target/**",
    "**/target/**",
    "__pycache__/**",
    "**/__pycache__/**",
    "*.pyc",
    "**/*.pyc",
    ".venv/**",
    "**/.venv/**",
    "venv/**",
    "**/venv/**",
    ".tarae/**",
    "**/.tarae/**",
    "tarae/**",
    "**/tarae/**",
    "dist/**",
    "**/dist/**",
    "build/**",
    "**/build/**",
    ".next/**",
    "**/.next/**",
    "*.lock",
    "**/*.lock",
    "package-lock.json",
    "Cargo.lock",
    ".DS_Store",
    "**/.DS_Store",
    "*.swp",
    "**/*.swp",
    "*.swo",
    "**/*.swo",
    "*~",
    "**/*~",
    "*.log",
    "**/*.log",
    "*.db",
    "**/*.db",
    "*.db-wal",
    "**/*.db-wal",
    "*.db-shm",
    "**/*.db-shm",
    "*.db-journal",
    "**/*.db-journal",
    "private/**",
    "**/private/**",
    "var/**",
    "**/var/**",
    "tmp/**",
    "**/tmp/**",
    "**/TemporaryItems/**",
    "**/com.apple.calaccessd/**",
];

impl TaraeIgnore {
    /// Load .taraeignore from project root, merging with defaults.
    pub fn load(root: &Path) -> Self {
        let mut patterns: Vec<Pattern> = DEFAULT_IGNORES
            .iter()
            .filter_map(|p| Pattern::new(p).ok())
            .collect();

        let ignore_file = root.join(".taraeignore");
        if ignore_file.exists() {
            if let Ok(content) = std::fs::read_to_string(&ignore_file) {
                for line in content.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.starts_with('#') {
                        continue;
                    }
                    if let Ok(pattern) = Pattern::new(trimmed) {
                        patterns.push(pattern);
                    }
                }
            }
        }

        Self { patterns }
    }

    /// Check if a relative path should be ignored.
    pub fn is_ignored(&self, path: &str) -> bool {
        // 1. Check glob patterns
        if self.patterns.iter().any(|p| p.matches(path)) {
            return true;
        }

        // 2. Fail-safe structural check
        let path_obj = Path::new(path);
        for component in path_obj.components() {
            if matches!(
                component.as_os_str().to_str(),
                Some(
                    "node_modules"
                        | ".git"
                        | ".gemini"
                        | "Library"
                        | "cache"
                        | ".cache"
                        | ".ruff_cache"
                        | ".pytest_cache"
                        | ".mypy_cache"
                        | ".uv-cache"
                        | ".turbo"
                        | ".parcel-cache"
                        | ".vite"
                        | ".wrangler"
                        | ".vercel"
                        | ".pnpm-store"
                        | ".Trash"
                        | "target"
                        | "__pycache__"
                        | ".venv"
                        | "venv"
                        | ".tarae"
                        | "tarae"
                        | "dist"
                        | "build"
                        | ".next"
                        | "private"
                        | "var"
                        | "tmp"
                        | "TemporaryItems"
                        | "com.apple.calaccessd"
                )
            ) {
                return true;
            }
        }

        // 3. Extension check
        if matches!(
            path_obj.extension().and_then(|e| e.to_str()),
            Some(
                "log"
                    | "tmp"
                    | "pyc"
                    | "swp"
                    | "swo"
                    | "lock"
                    | "db"
                    | "db-wal"
                    | "db-shm"
                    | "db-journal"
            )
        ) {
            return true;
        }

        path_obj
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(looks_like_ephemeral_file_name)
    }
}

fn looks_like_ephemeral_file_name(name: &str) -> bool {
    if name.contains('.')
        || !(8..=16).contains(&name.len())
        || !name.is_ascii()
        || !name.chars().all(|ch| ch.is_ascii_alphanumeric())
    {
        return false;
    }

    name.chars().any(|ch| ch.is_ascii_uppercase())
        && name.chars().any(|ch| ch.is_ascii_lowercase())
        && name.chars().any(|ch| ch.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_default_ignores() {
        let dir = TempDir::new().unwrap();
        let ignore = TaraeIgnore::load(dir.path());

        assert!(ignore.is_ignored("node_modules/foo/bar.js"));
        assert!(ignore.is_ignored(".git/config"));
        assert!(ignore.is_ignored("target/debug/build"));
        assert!(ignore.is_ignored(".DS_Store"));
        assert!(!ignore.is_ignored("src/main.rs"));

        // Verify deep subfolder ignores
        assert!(ignore.is_ignored("packages/watcher/target/debug/build"));
        assert!(ignore.is_ignored("packages/web/node_modules/react/index.js"));
        assert!(ignore.is_ignored("app.log"));
        assert!(ignore.is_ignored("src/app.log"));
        assert!(ignore.is_ignored("packages/tool/.ruff_cache/0.15.13/4027149680877948934"));
        assert!(ignore.is_ignored("packages/tool/cache/build.tmp"));
        assert!(ignore.is_ignored("XXUWZ3mb"));

        // Verify local Tarae history and database-like files are ignored
        assert!(ignore.is_ignored(".tarae/topa/sessions/session.jsonl"));
        assert!(ignore.is_ignored("Users/testuser/Library/Application Support/tarae/local.db"));
        assert!(ignore.is_ignored("Users/testuser/Library/Application Support/tarae/local.db-wal"));
        assert!(ignore.is_ignored("Users/testuser/Library/Application Support/tarae/local.db-shm"));
        assert!(
            ignore.is_ignored("Users/testuser/Library/Application Support/tarae/local.db-journal")
        );
        assert!(ignore.is_ignored("tarae/local.db"));

        // Verify macOS temporary system folder/files ignores
        assert!(ignore.is_ignored("private/var/folders/24/gvhl0bs55jx0y_v3qwk2yvz80000gn/T/com.apple.calaccessd/TemporaryItems/NSIRD_calaccessd_D"));
        assert!(ignore.is_ignored("var/folders/24/gvhl0bs55jx0y_v3qwk2yvz80000gn/T/com.apple.calaccessd/TemporaryItems/NSIRD_calaccessd_D"));
    }

    #[test]
    fn test_custom_ignores() {
        let dir = TempDir::new().unwrap();
        fs::write(
            dir.path().join(".taraeignore"),
            "*.log\nsecrets/**\n# comment\n",
        )
        .unwrap();
        let ignore = TaraeIgnore::load(dir.path());

        assert!(ignore.is_ignored("app.log"));
        assert!(ignore.is_ignored("secrets/api_key.txt"));
        assert!(!ignore.is_ignored("src/main.rs"));
    }

    #[test]
    fn test_empty_taraeignore_file() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join(".taraeignore"), "").unwrap();
        let ignore = TaraeIgnore::load(dir.path());
        // Should still use default ignores
        assert!(ignore.is_ignored("node_modules/foo.js"));
        assert!(ignore.is_ignored(".git/config"));
        assert!(!ignore.is_ignored("src/main.rs"));
    }

    #[test]
    fn test_comment_only_taraeignore() {
        let dir = TempDir::new().unwrap();
        fs::write(
            dir.path().join(".taraeignore"),
            "# This is a comment\n# Another comment\n  \n",
        )
        .unwrap();
        let ignore = TaraeIgnore::load(dir.path());
        assert!(ignore.is_ignored("node_modules/foo.js"));
        assert!(!ignore.is_ignored("src/lib.rs"));
    }

    #[test]
    fn test_allowed_source_files() {
        let dir = TempDir::new().unwrap();
        let ignore = TaraeIgnore::load(dir.path());
        assert!(!ignore.is_ignored("src/main.rs"));
        assert!(!ignore.is_ignored("app/views.py"));
        assert!(!ignore.is_ignored("components/App.tsx"));
        assert!(!ignore.is_ignored("components/Button.ts"));
        assert!(!ignore.is_ignored("cmd/app/main.go"));
        assert!(!ignore.is_ignored("index.html"));
        assert!(!ignore.is_ignored("styles.css"));
        assert!(!ignore.is_ignored("Makefile"));
    }

    #[test]
    fn test_extension_check() {
        let dir = TempDir::new().unwrap();
        let ignore = TaraeIgnore::load(dir.path());
        assert!(ignore.is_ignored("app.log"));
        assert!(ignore.is_ignored("cache.tmp"));
        assert!(ignore.is_ignored("module.pyc"));
        assert!(ignore.is_ignored("edit.swp"));
        assert!(ignore.is_ignored("edit.swo"));
    }

    #[test]
    fn test_nested_node_modules() {
        let dir = TempDir::new().unwrap();
        let ignore = TaraeIgnore::load(dir.path());
        assert!(ignore.is_ignored("packages/web/node_modules/react/index.js"));
        assert!(ignore.is_ignored("a/b/c/node_modules/d/e.js"));
    }
}
