use figment::{
    providers::{Env, Format, Toml},
    Figment,
};
use serde::Deserialize;

#[derive(Debug, Deserialize, Clone)]
pub struct AppConfig {
    /// Project root path (auto-detected if not set)
    pub project_root: Option<String>,
    /// Auto-checkpoint threshold (number of file changes)
    #[serde(default = "default_auto_checkpoint_threshold")]
    pub auto_checkpoint_threshold: u32,
    /// Preferred language for watcher-generated summaries.
    #[serde(default = "default_summary_language")]
    pub summary_language: String,
    /// AI agent name supplied by the MCP link configuration, for example codex or gemini.
    pub agent_name: Option<String>,
    /// Stable MCP link identifier supplied by the CLI link configuration.
    pub link_id: Option<String>,
}

fn default_auto_checkpoint_threshold() -> u32 {
    5
}

fn default_summary_language() -> String {
    "ko".to_string()
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            project_root: None,
            auto_checkpoint_threshold: default_auto_checkpoint_threshold(),
            summary_language: default_summary_language(),
            agent_name: None,
            link_id: None,
        }
    }
}

impl AppConfig {
    /// Load configuration from TOML file and environment variables.
    /// Priority: ENV > .tarae/config.toml > defaults
    pub fn load() -> Result<Self, Box<figment::Error>> {
        Figment::new()
            .merge(Toml::file(".tarae/config.toml"))
            .merge(Env::prefixed("TARAE_"))
            .extract()
            .map_err(Box::new)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = AppConfig::default();
        assert!(config.project_root.is_none());
        assert_eq!(config.auto_checkpoint_threshold, 5);
        assert_eq!(config.summary_language, "ko");
        assert!(config.agent_name.is_none());
        assert!(config.link_id.is_none());
    }

    #[test]
    fn test_default_thresholds() {
        assert_eq!(default_auto_checkpoint_threshold(), 5);
    }
}
