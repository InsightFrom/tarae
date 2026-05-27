use anyhow::Result;
use rmcp::ServiceExt;
use std::sync::Arc;
use tokio::io::{stdin, stdout};

use super::tools::TaraeServer;
use crate::config::AppConfig;

/// Run the MCP server over stdio transport.
pub async fn run_stdio_server(override_project_root: Option<String>) -> Result<()> {
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
    let server = TaraeServer::new(config_arc.clone());

    let service = server.clone().serve((stdin(), stdout())).await?;

    // Spawn a watcher only when a safe root is available at startup.
    // Without a configured root, start_session can resolve one later from MCP roots/list
    // or from its project_root parameter and start the watcher then.
    server.start_configured_watcher().await;

    // Block until the transport is closed (client disconnects)
    service.waiting().await?;

    tracing::info!("MCP server shut down");
    Ok(())
}
