use tauri::{State, AppHandle, Manager};

use crate::hook_installer;
use crate::server::PendingPermissions;
#[tauri::command]
pub async fn get_server_status() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "running": true,
        "port": 45832
    }))
}

#[tauri::command(rename_all = "camelCase")]
pub async fn resolve_permission(
    pending: State<'_, PendingPermissions>,
    request_id: String,
    decision: serde_json::Value,
) -> Result<(), String> {
    mlog!("resolve_permission called: id={}", request_id);
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

#[tauri::command]
pub fn set_overlay_permission_visible(visible: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        crate::win_overlay::PERMISSION_HIT_VISIBLE
            .store(visible, std::sync::atomic::Ordering::Relaxed);
    }
    #[cfg(not(target_os = "windows"))]
    let _ = visible;
    Ok(())
}

#[tauri::command]
pub fn set_overlay_working_bubble_visible(visible: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        crate::win_overlay::WORKING_BUBBLE_VISIBLE
            .store(visible, std::sync::atomic::Ordering::Relaxed);
    }
    #[cfg(not(target_os = "windows"))]
    let _ = visible;
    Ok(())
}

#[tauri::command]
pub fn set_overlay_dragging(dragging: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        crate::win_overlay::DRAGGING.store(dragging, std::sync::atomic::Ordering::Relaxed);
    }
    #[cfg(not(target_os = "windows"))]
    let _ = dragging;
    Ok(())
}

#[tauri::command]
pub fn update_mascot_position(x: i32, y: i32, w: i32, h: i32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    crate::win_overlay::update_mascot_position(x, y, w, h);
    #[cfg(not(target_os = "windows"))]
    { let _ = (x, y, w, h); }
    Ok(())
}

/// Returns (left, top, width, height) of the monitor containing the given screen point.
#[tauri::command]
pub fn get_monitor_at_point(x: i32, y: i32) -> Result<(i32, i32, i32, i32), String> {
    #[cfg(target_os = "windows")]
    {
        Ok(crate::win_overlay::monitor_bounds_at_point(x, y))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (x, y);
        Ok((0, 0, 1920, 1080))
    }
}

#[tauri::command]
pub fn update_working_bubble_zone(x: i32, y: i32, w: i32, h: i32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    crate::win_overlay::update_bubble_zone(x, y, w, h);
    #[cfg(not(target_os = "windows"))]
    let _ = (x, y, w, h);
    Ok(())
}

#[tauri::command]
pub fn update_permission_zone(x: i32, y: i32, w: i32, h: i32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    crate::win_overlay::update_permission_zone(x, y, w, h);
    #[cfg(not(target_os = "windows"))]
    let _ = (x, y, w, h);
    Ok(())
}

#[tauri::command]
pub fn open_devtools(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("overlay") {
        win.open_devtools();
    }
    Ok(())
}

/// Returns (left, top, width, height) of the entire virtual desktop (all monitors).
#[tauri::command]
pub fn get_virtual_desktop_bounds() -> Result<(i32, i32, i32, i32), String> {
    #[cfg(target_os = "windows")]
    {
        Ok(crate::win_overlay::get_virtual_desktop_bounds())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok((0, 0, 1920, 1080))
    }
}

/// Move overlay window to cover the monitor at the given screen point. Returns new bounds.
#[tauri::command]
pub fn move_overlay_to_monitor(app: AppHandle, x: i32, y: i32) -> Result<(i32, i32, i32, i32), String> {
    #[cfg(target_os = "windows")]
    {
        let bounds = crate::win_overlay::monitor_bounds_at_point(x, y);
        if let Some(overlay) = app.get_webview_window("overlay") {
            let hwnd_raw = overlay.hwnd().map_err(|e| e.to_string())?.0 as *mut std::ffi::c_void;
            unsafe { crate::win_overlay::resize_to_monitor(hwnd_raw, bounds.0, bounds.1, bounds.2, bounds.3); }
        }
        Ok(bounds)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, x, y);
        Ok((0, 0, 1920, 1080))
    }
}
