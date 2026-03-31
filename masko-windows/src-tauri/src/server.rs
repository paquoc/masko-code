use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, Mutex};

use crate::models::{AgentEvent, InputEvent};
use std::path::PathBuf;

const DEFAULT_PORT: u16 = 45832;
pub const MAX_PORT_ATTEMPTS: u16 = 10;

pub type PendingPermissions = Arc<Mutex<HashMap<String, oneshot::Sender<serde_json::Value>>>>;

#[derive(Clone)]
pub struct AppState {
    pub app_handle: AppHandle,
    pub pending_permissions: PendingPermissions,
    #[allow(dead_code)]
    pub port: u16,
}

pub async fn start(app_handle: AppHandle, pending_permissions: PendingPermissions) -> Result<(), Box<dyn std::error::Error>> {

    for offset in 0..MAX_PORT_ATTEMPTS {
        let port = DEFAULT_PORT + offset;
        let state = AppState {
            app_handle: app_handle.clone(),
            pending_permissions: pending_permissions.clone(),
            port,
        };

        let app = Router::new()
            .route("/health", get(health))
            .route("/hook", post(handle_hook))
            .route("/input", post(handle_input))
            .route("/install", post(handle_install))
            .with_state(state);

        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        match tokio::net::TcpListener::bind(addr).await {
            Ok(listener) => {
                mlog!("Server listening on port {port}");
                app_handle
                    .emit("server-status", serde_json::json!({"running": true, "port": port}))
                    .ok();

                // Start polling for hook drop files (Stop/SessionEnd events
                // that can't use HTTP because Windows kills the process tree)
                let poll_handle = app_handle.clone();
                tokio::spawn(poll_hook_drops(poll_handle));

                axum::serve(listener, app).await?;
                return Ok(());
            }
            Err(e) => {
                mlog_err!("Port {port} unavailable: {e}");
                continue;
            }
        }
    }

    mlog_err!(
        "Could not bind to any port in range {DEFAULT_PORT}-{}",
        DEFAULT_PORT + MAX_PORT_ATTEMPTS - 1
    );
    Ok(())
}

async fn health() -> &'static str {
    "ok"
}

async fn handle_hook(
    State(state): State<AppState>,
    Json(event): Json<AgentEvent>,
) -> impl IntoResponse {
    mlog!("Hook: {}", event.hook_event_name);

    if event.hook_event_name == "PermissionRequest" {
        // Create a oneshot channel — hold the HTTP connection until user decides
        let (tx, rx) = oneshot::channel::<serde_json::Value>();
        let request_id = uuid::Uuid::new_v4().to_string();

        // Store sender for later resolution
        state
            .pending_permissions
            .lock()
            .await
            .insert(request_id.clone(), tx);

        // Emit to frontend with request_id
        let mut payload = serde_json::to_value(&event).unwrap_or_default();
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("request_id".to_string(), serde_json::Value::String(request_id.clone()));
        }
        state.app_handle.emit("hook-event", &payload).ok();
        // Also forward as regular event for tracking
        state.app_handle.emit("permission-request", &payload).ok();

        // Wait for user decision (timeout 120s)
        match tokio::time::timeout(std::time::Duration::from_secs(120), rx).await {
            Ok(Ok(decision)) => {
                let body = serde_json::to_string(&decision).unwrap_or_default();
                mlog!("Permission resolved, body: {}", body);
                // Check if decision contains deny behavior
                let is_deny = decision
                    .pointer("/hookSpecificOutput/decision/behavior")
                    .and_then(|v| v.as_str())
                    == Some("deny");
                if is_deny {
                    return (StatusCode::FORBIDDEN, body);
                }
                (StatusCode::OK, body)
            }
            _ => {
                // Timeout or channel dropped — clean up and notify frontend
                state.pending_permissions.lock().await.remove(&request_id);
                state.app_handle.emit("permission-dismissed",
                    serde_json::json!({"request_id": request_id})).ok();
                (StatusCode::REQUEST_TIMEOUT, "timeout".to_string())
            }
        }
    } else {
        // Fire-and-forget: emit to frontend and respond immediately
        state.app_handle.emit("hook-event", &event).ok();

        (StatusCode::OK, "OK".to_string())
    }
}

async fn handle_input(
    State(state): State<AppState>,
    Json(input): Json<InputEvent>,
) -> impl IntoResponse {
    mlog!("Input: {} = {}", input.name, input.value);
    state.app_handle.emit("input-event", &input).ok();
    StatusCode::OK
}

async fn handle_install(
    State(state): State<AppState>,
    Json(config): Json<serde_json::Value>,
) -> impl IntoResponse {
    mlog!("Install received");
    state.app_handle.emit("mascot-install", &config).ok();
    // CORS headers for browser requests from masko.ai
    (
        StatusCode::OK,
        [
            ("Access-Control-Allow-Origin", "*"),
            ("Access-Control-Allow-Methods", "POST, OPTIONS"),
            ("Access-Control-Allow-Headers", "Content-Type"),
        ],
        "OK",
    )
}

/// Resolve a pending permission request (called from frontend via IPC)
pub async fn resolve(
    pending: &PendingPermissions,
    request_id: String,
    decision: serde_json::Value,
) -> Result<(), String> {
    if let Some(tx) = pending.lock().await.remove(&request_id) {
        tx.send(decision).map_err(|_| "channel closed".to_string())
    } else {
        Err(format!("no pending permission with id {request_id}"))
    }
}

/// Poll ~/.masko-desktop/hook-drops/ for JSON files written by the hook script
/// when the parent process kills the tree before curl can finish (Stop, SessionEnd, etc.)
async fn poll_hook_drops(app_handle: AppHandle) {
    let drop_dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".masko-desktop")
        .join("hook-drops");

    // Ensure directory exists
    let _ = std::fs::create_dir_all(&drop_dir);

    loop {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;

        let entries = match std::fs::read_dir(&drop_dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }

            // Read and parse
            match std::fs::read_to_string(&path) {
                Ok(contents) => {
                    // Remove file immediately to avoid re-processing
                    let _ = std::fs::remove_file(&path);

                    match serde_json::from_str::<AgentEvent>(&contents) {
                        Ok(event) => {
                            mlog!("Hook (drop): {}", event.hook_event_name);
                            app_handle.emit("hook-event", &event).ok();
                        }
                        Err(e) => {
                            mlog_err!("Failed to parse drop file {}: {e}", path.display());
                        }
                    }
                }
                Err(e) => {
                    mlog_err!("Failed to read drop file {}: {e}", path.display());
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
    }
}
