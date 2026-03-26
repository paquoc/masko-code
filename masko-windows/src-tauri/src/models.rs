use serde::{Deserialize, Serialize};

/// Agent hook event — matches the JSON schema from Claude Code / Codex hooks.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentEvent {
    pub hook_event_name: String,
    pub session_id: Option<String>,
    pub cwd: Option<String>,
    pub permission_mode: Option<String>,
    pub transcript_path: Option<String>,
    pub tool_name: Option<String>,
    pub tool_input: Option<serde_json::Value>,
    pub tool_response: Option<serde_json::Value>,
    pub tool_use_id: Option<String>,
    pub message: Option<String>,
    pub title: Option<String>,
    pub notification_type: Option<String>,
    pub source: Option<String>,
    pub reason: Option<String>,
    pub model: Option<String>,
    pub stop_hook_active: Option<bool>,
    pub last_assistant_message: Option<String>,
    pub agent_id: Option<String>,
    pub agent_type: Option<String>,
    pub task_id: Option<String>,
    pub task_subject: Option<String>,
    pub permission_suggestions: Option<serde_json::Value>,
    pub terminal_pid: Option<i64>,
    pub shell_pid: Option<i64>,
}

/// Custom input event (POST /input)
#[derive(Debug, Serialize, Deserialize)]
pub struct InputEvent {
    pub name: String,
    pub value: serde_json::Value,
}

/// Server status response
#[derive(Debug, Serialize)]
pub struct ServerStatus {
    pub running: bool,
    pub port: u16,
}

/// Permission resolution from frontend
#[derive(Debug, Deserialize)]
pub struct PermissionResolution {
    pub request_id: String,
    pub decision: serde_json::Value,
}
