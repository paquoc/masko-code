use tauri::State;

use crate::hook_installer;
use crate::server::PendingPermissions;

#[tauri::command]
pub async fn get_server_status() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "running": true,
        "port": 45832
    }))
}

#[tauri::command]
pub async fn resolve_permission(
    pending: State<'_, PendingPermissions>,
    request_id: String,
    decision: serde_json::Value,
) -> Result<(), String> {
    crate::server::resolve(&pending, request_id, decision).await
}

#[tauri::command]
pub async fn install_hooks() -> Result<(), String> {
    hook_installer::install(45832)
}

#[tauri::command]
pub async fn uninstall_hooks() -> Result<(), String> {
    hook_installer::uninstall()
}

#[tauri::command]
pub async fn is_hooks_registered() -> Result<bool, String> {
    Ok(hook_installer::is_registered())
}
