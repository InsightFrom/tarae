use regex::Regex;
use std::sync::LazyLock;

/// Regex patterns for common PII/secrets.
static PII_PATTERNS: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    vec![
        // API keys and tokens (common patterns)
        (
            Regex::new(
                r#"(?i)(api[_-]?key|token|secret|password|passwd|pwd)\s*[=:]\s*['"]?([^\s'"]+)"#,
            )
            .unwrap(),
            "$1=***REDACTED***",
        ),
        // Email addresses
        (
            Regex::new(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}").unwrap(),
            "***@***.***",
        ),
        // AWS keys
        (Regex::new(r"AKIA[0-9A-Z]{16}").unwrap(), "***AWS_KEY***"),
        // JWT tokens
        (
            Regex::new(r"eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+").unwrap(),
            "***JWT***",
        ),
        // Private keys
        (
            Regex::new(r"-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----").unwrap(),
            "***PRIVATE_KEY***",
        ),
        // Connection strings with passwords
        (
            Regex::new(r"(postgresql|mysql|mongodb|redis)://[^@]+@").unwrap(),
            "$1://***:***@",
        ),
    ]
});

/// PII masking filter for development logs.
pub struct PiiFilter;

impl PiiFilter {
    /// Filter PII from a text string.
    pub fn filter_text(input: &str) -> String {
        let mut result = input.to_string();
        for (pattern, replacement) in PII_PATTERNS.iter() {
            result = pattern.replace_all(&result, *replacement).to_string();
        }
        result
    }

    /// Check if a file path is sensitive.
    #[allow(dead_code)]
    pub fn is_sensitive_path(path: &str) -> bool {
        let lower = path.to_lowercase();
        let sensitive = [
            ".env",
            "secret",
            "credential",
            "password",
            "auth",
            ".pem",
            ".key",
            ".p12",
            ".pfx",
            "id_rsa",
            "id_ed25519",
            ".aws/",
            "kubeconfig",
        ];
        sensitive.iter().any(|s| lower.contains(s))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_filter_api_key() {
        let input = "api_key = 'sk-1234567890abcdef'";
        let filtered = PiiFilter::filter_text(input);
        assert!(!filtered.contains("sk-1234567890abcdef"));
        assert!(filtered.contains("REDACTED"));
    }

    #[test]
    fn test_filter_email() {
        let input = "Contact user@example.com for details";
        let filtered = PiiFilter::filter_text(input);
        assert!(!filtered.contains("user@example.com"));
    }

    #[test]
    fn test_filter_connection_string() {
        let input = "postgresql://admin:supersecret@db.example.com:5432/mydb";
        let filtered = PiiFilter::filter_text(input);
        assert!(!filtered.contains("supersecret"));
    }

    #[test]
    fn test_sensitive_path() {
        assert!(PiiFilter::is_sensitive_path("src/.env.local"));
        assert!(PiiFilter::is_sensitive_path("config/secrets.yml"));
        assert!(!PiiFilter::is_sensitive_path("src/main.rs"));
    }

    #[test]
    fn test_filter_aws_key() {
        let input = "Using key AKIAIOSFODNN7EXAMPLE for S3 access";
        let filtered = PiiFilter::filter_text(input);
        assert!(!filtered.contains("AKIAIOSFODNN7EXAMPLE"));
        assert!(filtered.contains("AWS_KEY"));
    }

    #[test]
    fn test_filter_jwt_token() {
        let input = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
        let filtered = PiiFilter::filter_text(input);
        assert!(!filtered.contains("eyJhbGciOiJIUzI1NiJ9"));
        assert!(filtered.contains("JWT"));
    }

    #[test]
    fn test_filter_private_key() {
        let input = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAK...";
        let filtered = PiiFilter::filter_text(input);
        assert!(!filtered.contains("BEGIN RSA PRIVATE KEY"));
        assert!(filtered.contains("PRIVATE_KEY"));
    }

    #[test]
    fn test_filter_preserves_safe_text() {
        let input = "This is a normal log message about fixing bug #1234";
        let filtered = PiiFilter::filter_text(input);
        assert_eq!(filtered, input);
    }

    #[test]
    fn test_filter_multiple_pii() {
        let input = "api_key='sk-secret123' and contact admin@example.com";
        let filtered = PiiFilter::filter_text(input);
        assert!(!filtered.contains("sk-secret123"));
        assert!(!filtered.contains("admin@example.com"));
    }

    #[test]
    fn test_sensitive_path_all_extensions() {
        assert!(PiiFilter::is_sensitive_path("server.pem"));
        assert!(PiiFilter::is_sensitive_path("ssl/cert.key"));
        assert!(PiiFilter::is_sensitive_path("certs/client.p12"));
        assert!(PiiFilter::is_sensitive_path("certs/client.pfx"));
        assert!(PiiFilter::is_sensitive_path("~/.ssh/id_rsa"));
        assert!(PiiFilter::is_sensitive_path("~/.ssh/id_ed25519"));
        assert!(PiiFilter::is_sensitive_path("~/.aws/credentials"));
        assert!(PiiFilter::is_sensitive_path("kubeconfig.yml"));
    }

    #[test]
    fn test_non_sensitive_common_paths() {
        assert!(!PiiFilter::is_sensitive_path("src/main.rs"));
        assert!(!PiiFilter::is_sensitive_path("README.md"));
        assert!(!PiiFilter::is_sensitive_path("package.json"));
        assert!(!PiiFilter::is_sensitive_path("Cargo.toml"));
        assert!(!PiiFilter::is_sensitive_path("app/api/routes.py"));
    }
}
