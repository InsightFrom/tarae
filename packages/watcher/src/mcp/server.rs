use anyhow::Result;
use rmcp::ServiceExt;
use std::sync::Arc;
use tokio::io::{stdin, stdout};

use super::tools::{TaraeBridgeServer, TaraeServer};
use crate::config::AppConfig;

/// Run the MCP server over stdio transport.
pub async fn run_stdio_server(
    override_project_root: Option<String>,
    direct_stdio: bool,
) -> Result<()> {
    let mut config = AppConfig::load().unwrap_or_else(|_| AppConfig::default());

    if let Some(project_root) = override_project_root {
        config.project_root = Some(project_root);
    }
    if config.project_root.is_none() {
        if let Some(root) = crate::watcher::root::resolve_project_root(None)? {
            config.project_root = Some(root.display().to_string());
        }
    }

    tracing::info!(
        project_root = ?config.project_root,
        "Tarae MCP server starting (stdio transport)..."
    );

    let config_arc = Arc::new(config);
    let use_direct_stdio = direct_stdio
        || std::env::var("TARAE_DISABLE_DAEMON")
            .map(|value| value == "true" || value == "1")
            .unwrap_or(false);

    if use_direct_stdio {
        let server = TaraeServer::new(config_arc.clone());
        let service = server.clone().serve((stdin(), stdout())).await?;

        // Legacy/debug mode: this process owns the watcher and history writes.
        server.core().start_configured_watcher().await;
        service.waiting().await?;
        tracing::info!("MCP direct stdio server shut down");
        return Ok(());
    }

    let server = TaraeBridgeServer::new(config_arc);
    let service = server.clone().serve((stdin(), stdout())).await?;

    // Bridge mode never starts a file watcher. The project daemon owns watching,
    // history writes, and active session state.
    service.waiting().await?;

    tracing::info!("MCP stdio bridge shut down");
    Ok(())
}
