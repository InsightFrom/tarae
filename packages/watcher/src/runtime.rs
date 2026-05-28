use anyhow::{Context, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::hash_map::DefaultHasher;
use std::fs::{self, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{watch, RwLock};
use uuid::Uuid;

use crate::config::AppConfig;
use crate::mcp::tools::{
    CheckpointParams, EndSessionParams, FetchContextParams, ListSessionsParams, ReadSessionParams,
    ReportIssueParams, SearchHistoryParams, StartSessionParams, TaraeCore,
};
use crate::watcher::root;

const RUNTIME_SCHEMA_VERSION: &str = "topa-runtime-v1";
const HEALTH_METHOD: &str = "health";
const SHUTDOWN_METHOD: &str = "shutdown";
const RPC_PATH: &str = "/rpc";
const MAX_HTTP_BYTES: usize = 1024 * 1024;
const DAEMON_READY_TIMEOUT: Duration = Duration::from_secs(10);
const LOCK_TIMEOUT: Duration = Duration::from_secs(8);
const STALE_LOCK_AFTER: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeMetadata {
    pub schema_version: String,
    pub pid: u32,
    pub endpoint: String,
    pub auth_token: String,
    pub auth_token_hash: String,
    pub project_root: String,
    pub version: String,
    pub started_at: String,
    pub heartbeat_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonHealth {
    pub pid: u32,
    pub project_root: String,
    pub version: String,
    pub started_at: String,
    pub heartbeat_at: String,
}

#[derive(Debug, Clone)]
pub struct DaemonStatus {
    pub metadata: Option<RuntimeMetadata>,
    pub healthy: bool,
    pub detail: String,
}

#[derive(Clone)]
pub struct DaemonClient {
    metadata: RuntimeMetadata,
}

#[derive(Debug, Serialize, Deserialize)]
struct RpcRequest {
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize, Deserialize)]
struct RpcResponse {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

struct RuntimePaths {
    runtime_dir: PathBuf,
    metadata_path: PathBuf,
    lock_path: PathBuf,
}

struct RuntimeLock {
    path: PathBuf,
}

impl Drop for RuntimeLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

impl DaemonClient {
    pub async fn call_string<T: Serialize + ?Sized>(
        &self,
        method: &str,
        params: &T,
    ) -> Result<String, String> {
        let value = self.call_value(method, params).await?;
        value
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| format!("daemon returned non-string response for {method}"))
    }

    async fn health(&self) -> Result<DaemonHealth, String> {
        let value = self
            .call_value(HEALTH_METHOD, &serde_json::json!({}))
            .await?;
        serde_json::from_value(value).map_err(|err| err.to_string())
    }

    async fn shutdown(&self) -> Result<String, String> {
        self.call_string(SHUTDOWN_METHOD, &serde_json::json!({}))
            .await
    }

    async fn call_value<T: Serialize + ?Sized>(
        &self,
        method: &str,
        params: &T,
    ) -> Result<Value, String> {
        let addr = endpoint_addr(&self.metadata.endpoint)?;
        let mut stream = TcpStream::connect(&addr)
            .await
            .map_err(|err| format!("failed to connect to topa daemon at {addr}: {err}"))?;
        let request = RpcRequest {
            method: method.to_string(),
            params: serde_json::to_value(params).map_err(|err| err.to_string())?,
        };
        let body = serde_json::to_vec(&request).map_err(|err| err.to_string())?;
        let header = format!(
            "POST {RPC_PATH} HTTP/1.1\r\nHost: {addr}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            self.metadata.auth_token,
            body.len()
        );
        stream
            .write_all(header.as_bytes())
            .await
            .map_err(|err| err.to_string())?;
        stream
            .write_all(&body)
            .await
            .map_err(|err| err.to_string())?;
        stream.shutdown().await.map_err(|err| err.to_string())?;

        let mut response = Vec::new();
        stream
            .read_to_end(&mut response)
            .await
            .map_err(|err| err.to_string())?;
        let (status, body) = parse_http_response(&response)?;
        if status != 200 {
            return Err(String::from_utf8_lossy(body).trim().to_string());
        }
        let rpc: RpcResponse = serde_json::from_slice(body).map_err(|err| err.to_string())?;
        if rpc.ok {
            Ok(rpc.result.unwrap_or(Value::Null))
        } else {
            Err(rpc.error.unwrap_or_else(|| "daemon RPC failed".to_string()))
        }
    }
}

pub async fn ensure_daemon(project_root: &Path) -> Result<DaemonClient, String> {
    let project_root = canonical_project_root(project_root).map_err(|err| err.to_string())?;
    if let Some(client) = healthy_client(&project_root).await {
        return Ok(client);
    }

    let _lock = acquire_runtime_lock(&project_root)
        .await
        .map_err(|err| err.to_string())?;
    if let Some(client) = healthy_client(&project_root).await {
        return Ok(client);
    }

    remove_metadata(&project_root);
    spawn_daemon_process(&project_root).map_err(|err| err.to_string())?;
    wait_for_daemon(&project_root).await
}

pub async fn shutdown_daemon(project_root: &Path) -> Result<String, String> {
    let project_root = canonical_project_root(project_root).map_err(|err| err.to_string())?;
    if let Some(client) = healthy_client(&project_root).await {
        let result = client.shutdown().await?;
        for _ in 0..20 {
            if !runtime_paths(&project_root).metadata_path.exists() {
                return Ok(result);
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        return Ok(result);
    }
    remove_metadata(&project_root);
    Ok("No running topa daemon for this project.".to_string())
}

pub async fn daemon_status(project_root: &Path) -> DaemonStatus {
    let Ok(project_root) = canonical_project_root(project_root) else {
        return DaemonStatus {
            metadata: None,
            healthy: false,
            detail: "invalid project root".to_string(),
        };
    };
    let metadata = read_metadata(&project_root);
    let Some(metadata_value) = metadata.clone() else {
        return DaemonStatus {
            metadata,
            healthy: false,
            detail: "no runtime metadata found".to_string(),
        };
    };
    let client = DaemonClient {
        metadata: metadata_value.clone(),
    };
    match client.health().await {
        Ok(health) if healthy_matches(&project_root, &metadata_value, &health) => DaemonStatus {
            metadata,
            healthy: true,
            detail: format!(
                "healthy pid={} endpoint={}",
                health.pid, metadata_value.endpoint
            ),
        },
        Ok(health) => DaemonStatus {
            metadata,
            healthy: false,
            detail: format!(
                "metadata mismatch: metadata pid={} health pid={}",
                metadata_value.pid, health.pid
            ),
        },
        Err(err) => DaemonStatus {
            metadata,
            healthy: false,
            detail: err,
        },
    }
}

pub async fn run_daemon(override_project_root: Option<String>) -> Result<()> {
    let mut config = AppConfig::load().unwrap_or_else(|_| AppConfig::default());
    if let Some(project_root) = override_project_root {
        config.project_root = Some(project_root);
    }
    let project_root = root::resolve_project_root(config.project_root.as_deref())?
        .context("No safe project root detected for topa daemon")?;
    config.project_root = Some(project_root.display().to_string());

    if healthy_client(&project_root).await.is_some() {
        tracing::info!(project_root = %project_root.display(), "topa daemon already running");
        return Ok(());
    }

    let _lock = if std::env::var("TARAE_DAEMON_LOCK_HELD")
        .map(|value| value == "1" || value == "true")
        .unwrap_or(false)
    {
        None
    } else {
        let lock = acquire_runtime_lock(&project_root).await?;
        if healthy_client(&project_root).await.is_some() {
            tracing::info!(project_root = %project_root.display(), "topa daemon already running");
            return Ok(());
        }
        Some(lock)
    };

    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let endpoint = format!("http://{}", listener.local_addr()?);
    let token = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let metadata = RuntimeMetadata {
        schema_version: RUNTIME_SCHEMA_VERSION.to_string(),
        pid: std::process::id(),
        endpoint,
        auth_token_hash: token_hash(&token),
        auth_token: token,
        project_root: project_root.display().to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        started_at: now.clone(),
        heartbeat_at: now,
    };
    let metadata = Arc::new(RwLock::new(metadata));
    write_metadata(&project_root, &*metadata.read().await)?;

    let config = Arc::new(config);
    let core = TaraeCore::new(config);
    core.start_configured_watcher().await;

    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);
    let heartbeat_root = project_root.clone();
    let heartbeat_meta = metadata.clone();
    let heartbeat_task = tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            {
                let mut meta = heartbeat_meta.write().await;
                meta.heartbeat_at = Utc::now().to_rfc3339();
                let _ = write_metadata(&heartbeat_root, &meta);
            }
        }
    });

    tracing::info!(
        project_root = %project_root.display(),
        endpoint = %metadata.read().await.endpoint,
        "topa daemon listening"
    );

    loop {
        tokio::select! {
            changed = shutdown_rx.changed() => {
                if changed.is_ok() && *shutdown_rx.borrow() {
                    break;
                }
            }
            accepted = listener.accept() => {
                let (stream, _) = accepted?;
                let core = core.clone();
                let metadata = metadata.clone();
                let project_root = project_root.clone();
                let shutdown_tx = shutdown_tx.clone();
                tokio::spawn(async move {
                    if let Err(err) = handle_rpc_connection(stream, core, metadata, project_root, shutdown_tx).await {
                        tracing::debug!("daemon RPC connection failed: {err}");
                    }
                });
            }
        }
    }

    heartbeat_task.abort();
    let _ = fs::remove_file(runtime_paths(&project_root).metadata_path);
    tracing::info!(project_root = %project_root.display(), "topa daemon shut down");
    Ok(())
}

async fn handle_rpc_connection(
    mut stream: TcpStream,
    core: TaraeCore,
    metadata: Arc<RwLock<RuntimeMetadata>>,
    daemon_root: PathBuf,
    shutdown_tx: watch::Sender<bool>,
) -> Result<()> {
    let request = read_http_request(&mut stream).await?;
    let expected_token = metadata.read().await.auth_token.clone();
    if request.method != "POST" || request.path != RPC_PATH {
        write_http_response(&mut stream, 404, b"not found").await?;
        return Ok(());
    }
    if request.authorization.as_deref() != Some(&format!("Bearer {expected_token}")) {
        write_http_response(&mut stream, 401, b"unauthorized").await?;
        return Ok(());
    }

    let rpc: RpcRequest = match serde_json::from_slice(&request.body) {
        Ok(value) => value,
        Err(err) => {
            let response = RpcResponse {
                ok: false,
                result: None,
                error: Some(err.to_string()),
            };
            write_json_response(&mut stream, 200, &response).await?;
            return Ok(());
        }
    };

    let response = dispatch_rpc(rpc, core, metadata, daemon_root, shutdown_tx).await;
    write_json_response(&mut stream, 200, &response).await?;
    Ok(())
}

async fn dispatch_rpc(
    rpc: RpcRequest,
    core: TaraeCore,
    metadata: Arc<RwLock<RuntimeMetadata>>,
    daemon_root: PathBuf,
    shutdown_tx: watch::Sender<bool>,
) -> RpcResponse {
    let result =
        match rpc.method.as_str() {
            HEALTH_METHOD => {
                let mut meta = metadata.write().await;
                meta.heartbeat_at = Utc::now().to_rfc3339();
                let _ = write_metadata(&daemon_root, &meta);
                serde_json::to_value(DaemonHealth {
                    pid: meta.pid,
                    project_root: meta.project_root.clone(),
                    version: meta.version.clone(),
                    started_at: meta.started_at.clone(),
                    heartbeat_at: meta.heartbeat_at.clone(),
                })
                .map_err(|err| err.to_string())
            }
            SHUTDOWN_METHOD => {
                let _ = shutdown_tx.send(true);
                Ok(Value::String("topa daemon shutdown requested.".to_string()))
            }
            "start_session" => {
                call_with_params::<StartSessionParams, _, _>(
                    rpc.params,
                    &daemon_root,
                    |root, params| async move { core.start_session_for_root(root, params).await },
                )
                .await
            }
            "checkpoint" => {
                call_with_params::<CheckpointParams, _, _>(
                    rpc.params,
                    &daemon_root,
                    |root, params| async move { core.checkpoint_for_root(root, params).await },
                )
                .await
            }
            "report_issue" => {
                call_with_params::<ReportIssueParams, _, _>(
                    rpc.params,
                    &daemon_root,
                    |root, params| async move { core.report_issue_for_root(root, params).await },
                )
                .await
            }
            "end_session" => {
                call_with_params::<EndSessionParams, _, _>(
                    rpc.params,
                    &daemon_root,
                    |root, params| async move { core.end_session_for_root(root, params).await },
                )
                .await
            }
            "fetch_past_context" => call_with_params::<FetchContextParams, _, _>(
                rpc.params,
                &daemon_root,
                |root, params| async move { core.fetch_past_context_for_root(root, params).await },
            )
            .await,
            "list_sessions" => {
                call_with_params::<ListSessionsParams, _, _>(
                    rpc.params,
                    &daemon_root,
                    |root, params| async move { core.list_sessions_for_root(root, params).await },
                )
                .await
            }
            "read_session" => {
                call_with_params::<ReadSessionParams, _, _>(
                    rpc.params,
                    &daemon_root,
                    |root, params| async move { core.read_session_for_root(root, params).await },
                )
                .await
            }
            "search_history" => {
                call_with_params::<SearchHistoryParams, _, _>(
                    rpc.params,
                    &daemon_root,
                    |root, params| async move { core.search_history_for_root(root, params).await },
                )
                .await
            }
            _ => Err(format!("unknown daemon RPC method: {}", rpc.method)),
        };

    match result {
        Ok(value) => RpcResponse {
            ok: true,
            result: Some(value),
            error: None,
        },
        Err(error) => RpcResponse {
            ok: false,
            result: None,
            error: Some(error),
        },
    }
}

async fn call_with_params<P, F, Fut>(
    params: Value,
    daemon_root: &Path,
    f: F,
) -> Result<Value, String>
where
    P: for<'de> Deserialize<'de> + RpcProjectRoot,
    F: FnOnce(PathBuf, P) -> Fut,
    Fut: std::future::Future<Output = Result<String, String>>,
{
    let params: P = serde_json::from_value(params).map_err(|err| err.to_string())?;
    let root = rpc_project_root(&params, daemon_root)?;
    let result = f(root, params).await?;
    Ok(Value::String(result))
}

trait RpcProjectRoot {
    fn project_root(&self) -> Option<&str>;
}

macro_rules! impl_rpc_project_root {
    ($($ty:ty),+ $(,)?) => {
        $(
            impl RpcProjectRoot for $ty {
                fn project_root(&self) -> Option<&str> {
                    self.project_root.as_deref()
                }
            }
        )+
    };
}

impl_rpc_project_root!(
    StartSessionParams,
    CheckpointParams,
    ReportIssueParams,
    EndSessionParams,
    FetchContextParams,
    ListSessionsParams,
    ReadSessionParams,
    SearchHistoryParams,
);

fn rpc_project_root<P: RpcProjectRoot>(params: &P, daemon_root: &Path) -> Result<PathBuf, String> {
    let daemon_root = canonical_project_root(daemon_root).map_err(|err| err.to_string())?;
    if let Some(project_root) = params.project_root() {
        let requested =
            canonical_project_root(Path::new(project_root)).map_err(|err| err.to_string())?;
        if requested != daemon_root {
            return Err(format!(
                "daemon for {} cannot serve {}",
                daemon_root.display(),
                requested.display()
            ));
        }
    }
    Ok(daemon_root)
}

async fn wait_for_daemon(project_root: &Path) -> Result<DaemonClient, String> {
    let deadline = tokio::time::Instant::now() + DAEMON_READY_TIMEOUT;
    let mut last_error = "daemon did not publish runtime metadata".to_string();
    while tokio::time::Instant::now() < deadline {
        if let Some(client) = healthy_client(project_root).await {
            return Ok(client);
        }
        if let Some(metadata) = read_metadata(project_root) {
            last_error = format!(
                "daemon metadata found but health check failed at {}",
                metadata.endpoint
            );
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err(last_error)
}

async fn healthy_client(project_root: &Path) -> Option<DaemonClient> {
    let metadata = read_metadata(project_root)?;
    if metadata.schema_version != RUNTIME_SCHEMA_VERSION
        || metadata.project_root != project_root.display().to_string()
        || metadata.version != env!("CARGO_PKG_VERSION")
    {
        return None;
    }
    let client = DaemonClient { metadata };
    let health = client.health().await.ok()?;
    if healthy_matches(project_root, &client.metadata, &health) {
        Some(client)
    } else {
        None
    }
}

fn healthy_matches(project_root: &Path, metadata: &RuntimeMetadata, health: &DaemonHealth) -> bool {
    metadata.pid == health.pid
        && metadata.version == health.version
        && health.version == env!("CARGO_PKG_VERSION")
        && metadata.project_root == project_root.display().to_string()
        && health.project_root == project_root.display().to_string()
}

async fn acquire_runtime_lock(project_root: &Path) -> Result<RuntimeLock> {
    let paths = runtime_paths(project_root);
    fs::create_dir_all(&paths.runtime_dir)?;
    let deadline = tokio::time::Instant::now() + LOCK_TIMEOUT;
    loop {
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&paths.lock_path)
        {
            Ok(mut file) => {
                writeln!(file, "pid={}", std::process::id())?;
                writeln!(file, "created_at={}", Utc::now().to_rfc3339())?;
                return Ok(RuntimeLock {
                    path: paths.lock_path,
                });
            }
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                if is_stale_file(&paths.lock_path, STALE_LOCK_AFTER) {
                    let _ = fs::remove_file(&paths.lock_path);
                    continue;
                }
                if tokio::time::Instant::now() >= deadline {
                    anyhow::bail!(
                        "timed out waiting for topa daemon startup lock at {}",
                        paths.lock_path.display()
                    );
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(err) => return Err(err.into()),
        }
    }
}

fn spawn_daemon_process(project_root: &Path) -> Result<()> {
    let current_exe =
        std::env::current_exe().context("failed to locate current topa executable")?;
    Command::new(current_exe)
        .arg("daemon")
        .arg("--project-root")
        .arg(project_root)
        .env("TARAE_DAEMON_LOCK_HELD", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .context("failed to spawn topa daemon")?;
    Ok(())
}

fn read_metadata(project_root: &Path) -> Option<RuntimeMetadata> {
    let path = runtime_paths(project_root).metadata_path;
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn write_metadata(project_root: &Path, metadata: &RuntimeMetadata) -> Result<()> {
    let paths = runtime_paths(project_root);
    fs::create_dir_all(&paths.runtime_dir)?;
    let tmp_path = paths.metadata_path.with_extension("json.tmp");
    fs::write(&tmp_path, serde_json::to_vec_pretty(metadata)?)?;
    fs::rename(tmp_path, paths.metadata_path)?;
    Ok(())
}

fn remove_metadata(project_root: &Path) {
    let _ = fs::remove_file(runtime_paths(project_root).metadata_path);
}

fn runtime_paths(project_root: &Path) -> RuntimePaths {
    let runtime_dir = project_root.join(".tarae").join("topa").join("runtime");
    RuntimePaths {
        metadata_path: runtime_dir.join("server.json"),
        lock_path: runtime_dir.join("server.lock"),
        runtime_dir,
    }
}

fn canonical_project_root(path: &Path) -> Result<PathBuf> {
    path.canonicalize()
        .with_context(|| format!("failed to canonicalize {}", path.display()))
}

fn endpoint_addr(endpoint: &str) -> Result<String, String> {
    endpoint
        .strip_prefix("http://")
        .map(str::to_string)
        .ok_or_else(|| format!("unsupported daemon endpoint: {endpoint}"))
}

fn token_hash(token: &str) -> String {
    let mut hasher = DefaultHasher::new();
    token.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn is_stale_file(path: &Path, max_age: Duration) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return true;
    };
    let Ok(modified) = metadata.modified() else {
        return true;
    };
    SystemTime::now()
        .duration_since(modified)
        .map(|age| age > max_age)
        .unwrap_or(true)
}

struct HttpRequest {
    method: String,
    path: String,
    authorization: Option<String>,
    body: Vec<u8>,
}

async fn read_http_request(stream: &mut TcpStream) -> Result<HttpRequest> {
    let mut buffer = Vec::new();
    let header_end = loop {
        let mut chunk = [0u8; 1024];
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            anyhow::bail!("connection closed before HTTP headers");
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > MAX_HTTP_BYTES {
            anyhow::bail!("HTTP request too large");
        }
        if let Some(index) = find_header_end(&buffer) {
            break index;
        }
    };

    let headers = String::from_utf8_lossy(&buffer[..header_end]);
    let mut lines = headers.split("\r\n");
    let request_line = lines.next().context("missing HTTP request line")?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();
    let mut content_length = 0usize;
    let mut authorization = None;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            let name = name.trim().to_ascii_lowercase();
            let value = value.trim().to_string();
            match name.as_str() {
                "content-length" => content_length = value.parse().unwrap_or(0),
                "authorization" => authorization = Some(value),
                _ => {}
            }
        }
    }
    if content_length > MAX_HTTP_BYTES {
        anyhow::bail!("HTTP body too large");
    }

    let body_start = header_end + 4;
    while buffer.len() < body_start + content_length {
        let mut chunk = [0u8; 1024];
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            anyhow::bail!("connection closed before HTTP body");
        }
        buffer.extend_from_slice(&chunk[..read]);
    }

    Ok(HttpRequest {
        method,
        path,
        authorization,
        body: buffer[body_start..body_start + content_length].to_vec(),
    })
}

async fn write_json_response<T: Serialize>(
    stream: &mut TcpStream,
    status: u16,
    value: &T,
) -> Result<()> {
    let body = serde_json::to_vec(value)?;
    write_http_response(stream, status, &body).await
}

async fn write_http_response(stream: &mut TcpStream, status: u16, body: &[u8]) -> Result<()> {
    let reason = match status {
        200 => "OK",
        401 => "Unauthorized",
        404 => "Not Found",
        _ => "Error",
    };
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(header.as_bytes()).await?;
    stream.write_all(body).await?;
    stream.shutdown().await?;
    Ok(())
}

fn parse_http_response(response: &[u8]) -> Result<(u16, &[u8]), String> {
    let header_end =
        find_header_end(response).ok_or_else(|| "invalid HTTP response".to_string())?;
    let headers = String::from_utf8_lossy(&response[..header_end]);
    let status = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|status| status.parse::<u16>().ok())
        .ok_or_else(|| "invalid HTTP status".to_string())?;
    Ok((status, &response[header_end + 4..]))
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn token_hash_is_stable() {
        assert_eq!(token_hash("abc"), token_hash("abc"));
        assert_ne!(token_hash("abc"), token_hash("def"));
    }

    #[tokio::test]
    async fn runtime_lock_excludes_second_holder() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let _first = acquire_runtime_lock(&root).await.unwrap();
        let second =
            tokio::time::timeout(Duration::from_millis(200), acquire_runtime_lock(&root)).await;
        assert!(second.is_err());
    }

    #[test]
    fn parses_http_response_status_and_body() {
        let bytes = b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}";
        let (status, body) = parse_http_response(bytes).unwrap();
        assert_eq!(status, 200);
        assert_eq!(body, b"{}");
    }
}
