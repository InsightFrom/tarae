use anyhow::Result;
use clap::{Parser, Subcommand};
use tracing_subscriber::{fmt, EnvFilter};

mod config;
mod git;
mod history;
mod mcp;
mod security;
mod watcher;

#[derive(Parser)]
#[command(
    name = "topa",
    version,
    about = "Topa (톺아) — Tarae's non-invasive local observer & MCP server"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the MCP server (stdio transport)
    Serve {
        /// Project root directory that topa is allowed to watch
        #[arg(long)]
        project_root: Option<String>,
    },
    /// Show current status
    Status {
        /// Project root directory containing .tarae/topa
        #[arg(long)]
        project_root: Option<String>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing (stderr to avoid interfering with MCP stdio)
    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_target(false)
        .with_writer(std::io::stderr)
        .init();

    let cli = Cli::parse();

    match cli.command {
        Commands::Serve { project_root } => {
            tracing::info!("Starting Tarae MCP server (stdio)...");
            mcp::server::run_stdio_server(project_root).await?;
        }
        Commands::Status { project_root } => {
            let config = config::AppConfig::load().unwrap_or_default();
            println!("🔧 Tarae Watcher Status");
            let root = project_root.or(config.project_root);
            println!(
                "  Project root: {}",
                root.as_deref().unwrap_or("auto-detect")
            );
            println!(
                "  Auto-checkpoint threshold: {} files",
                config.auto_checkpoint_threshold
            );
            match watcher::root::resolve_project_root(root.as_deref()) {
                Ok(Some(root)) => match history::HistoryStore::open(&root) {
                    Ok(store) => {
                        let sessions = store.list_sessions(10, None).unwrap_or_default();
                        println!("  History dir: {}", store.topa_dir().display());
                        println!("  Recent sessions indexed: {}", sessions.len());
                    }
                    Err(e) => println!("  History: unavailable ({})", e),
                },
                Ok(None) => println!("  History: unavailable (no safe project root detected)"),
                Err(e) => println!("  History: unavailable ({})", e),
            }
        }
    }

    Ok(())
}
