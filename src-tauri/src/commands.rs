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
    manager: State<'_, std::sync::Arc<crate::telegram::TelegramManager>>,
    request_id: String,
    decision: serde_json::Value,
) -> Result<(), String> {
    mlog!("resolve_permission called: id={}", request_id);

    // Extract decision label for the Telegram follow-up message BEFORE moving decision.
    // Fall back to empty string — pretty_decision renders that as "Resolved" rather
    // than misleadingly showing "Approved" on a malformed or missing payload.
    let decision_label = decision
        .pointer("/hookSpecificOutput/decision/behavior")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // Forward to the hook HTTP response. Capture the error but DON'T early
    // return — the Telegram state still needs to be synced even if the hook
    // is already gone (CC timed out, user answered directly in the CLI, etc).
    // Otherwise `state.active` holds a phantom permission forever and the
    // next permission gets queued behind it (no new Telegram message sent).
    let hook_result = crate::server::resolve(&pending, request_id.clone(), decision).await;
    if let Err(ref e) = hook_result {
        mlog_err!(
            "resolve_permission: server::resolve failed (id={}): {} — syncing Telegram anyway",
            request_id,
            e
        );
    }

    // Notify Telegram — fire-and-forget style (spawn) so IPC returns quickly.
    let manager_clone: std::sync::Arc<crate::telegram::TelegramManager> = manager.inner().clone();
    let req_id = request_id.clone();
    tauri::async_runtime::spawn(async move {
        manager_clone.on_local_resolved(&req_id, &decision_label).await;
    });

    // Surface the hook error to the frontend only after the sync is queued.
    hook_result
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

/// Report the frontend's window.devicePixelRatio so the hit-test uses the
/// same scale as WebView2 rendering (avoids mismatch on some multi-monitor setups).
#[tauri::command(rename_all = "camelCase")]
pub fn update_frontend_dpr(dpr: f64) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let dpr_x1000 = (dpr * 1000.0).round() as u32;
        crate::win_overlay::update_frontend_dpr(dpr_x1000);
    }
    #[cfg(not(target_os = "windows"))]
    let _ = dpr;
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
pub fn set_overlay_token_panel_visible(visible: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        crate::win_overlay::TOKEN_PANEL_VISIBLE
            .store(visible, std::sync::atomic::Ordering::Relaxed);
    }
    #[cfg(not(target_os = "windows"))]
    let _ = visible;
    Ok(())
}

#[tauri::command]
pub fn update_token_panel_zone(x: i32, y: i32, w: i32, h: i32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    crate::win_overlay::update_token_panel_zone(x, y, w, h);
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

/// Temporarily allow keyboard focus on the overlay window (removes WS_EX_NOACTIVATE).
#[tauri::command]
pub fn focus_overlay(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::sync::atomic::Ordering;
        // Tell WM_STYLECHANGING handler to stop forcing WS_EX_NOACTIVATE
        crate::win_overlay::FOCUS_ALLOWED.store(true, Ordering::Relaxed);

        if let Some(overlay) = app.get_webview_window("overlay") {
            let hwnd = overlay.hwnd().map_err(|e| e.to_string())?;
            unsafe {
                use windows::Win32::UI::WindowsAndMessaging::*;
                use windows::Win32::Foundation::HWND;
                let h = HWND(hwnd.0 as *mut std::ffi::c_void);
                // Remove WS_EX_NOACTIVATE so the window can receive focus
                let ex = GetWindowLongW(h, GWL_EXSTYLE) as u32;
                SetWindowLongW(h, GWL_EXSTYLE, (ex & !WS_EX_NOACTIVATE.0) as i32);
                let _ = SetForegroundWindow(h);
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = app;
    Ok(())
}

/// Restore WS_EX_NOACTIVATE on the overlay so it stops stealing focus.
#[tauri::command]
pub fn unfocus_overlay(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::sync::atomic::Ordering;
        // Tell WM_STYLECHANGING handler to resume forcing WS_EX_NOACTIVATE
        crate::win_overlay::FOCUS_ALLOWED.store(false, Ordering::Relaxed);

        if let Some(overlay) = app.get_webview_window("overlay") {
            let hwnd = overlay.hwnd().map_err(|e| e.to_string())?;
            unsafe {
                use windows::Win32::UI::WindowsAndMessaging::*;
                use windows::Win32::Foundation::HWND;
                let h = HWND(hwnd.0 as *mut std::ffi::c_void);
                let ex = GetWindowLongW(h, GWL_EXSTYLE) as u32;
                SetWindowLongW(h, GWL_EXSTYLE, (ex | WS_EX_NOACTIVATE.0) as i32);
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = app;
    Ok(())
}

#[tauri::command]
pub fn get_autostart() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    return Ok(crate::autostart::is_enabled());
    #[cfg(not(target_os = "windows"))]
    Ok(false)
}

#[tauri::command]
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return crate::autostart::set_enabled(enabled);
    #[cfg(not(target_os = "windows"))]
    {
        let _ = enabled;
        Ok(())
    }
}

#[tauri::command]
pub fn quit_app(app: AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn open_devtools(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("overlay") {
        win.open_devtools();
    }
    Ok(())
}

/// Diagnostic dump: overlay window rect, virtual desktop, all monitors, DPI info.
/// Returns a JSON object for remote debugging of multi-monitor hit-test issues.
#[tauri::command]
pub fn debug_overlay_info(app: AppHandle) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "windows")]
    {
        let info = if let Some(overlay) = app.get_webview_window("overlay") {
            let hwnd_raw = overlay.hwnd().map_err(|e| e.to_string())?.0 as usize;
            crate::win_overlay::collect_debug_info(hwnd_raw)
        } else {
            serde_json::json!({"error": "overlay window not found"})
        };
        mlog!("debug_overlay_info: {}", info);
        Ok(info)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Ok(serde_json::json!({"platform": "not windows"}))
    }
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

// ===== Telegram commands =====

use std::sync::Arc;

use crate::telegram::types::{TelegramConfigDto, TelegramStatus, TelegramTestResult};
use crate::telegram::TelegramManager;

#[tauri::command]
pub async fn telegram_get_config(
    manager: tauri::State<'_, Arc<TelegramManager>>,
) -> Result<TelegramConfigDto, String> {
    Ok(manager.get_config_dto().await)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn telegram_save_config(
    manager: tauri::State<'_, Arc<TelegramManager>>,
    token: String,
    chat_id: String,
) -> Result<(), String> {
    manager.save_config(token, chat_id).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn telegram_test(
    manager: tauri::State<'_, Arc<TelegramManager>>,
    token: String,
    chat_id: Option<String>,
) -> Result<TelegramTestResult, String> {
    manager.test(token, chat_id).await
}

#[tauri::command]
pub async fn telegram_set_polling_enabled(
    manager: tauri::State<'_, Arc<TelegramManager>>,
    enabled: bool,
) -> Result<(), String> {
    manager.set_polling_enabled(enabled).await
}

#[tauri::command]
pub async fn telegram_set_sending_enabled(
    manager: tauri::State<'_, Arc<TelegramManager>>,
    enabled: bool,
) -> Result<(), String> {
    manager.set_sending_enabled(enabled).await
}

#[tauri::command]
pub async fn telegram_get_status(
    manager: tauri::State<'_, Arc<TelegramManager>>,
) -> Result<TelegramStatus, String> {
    Ok(manager.get_status().await)
}

// ===== Token usage commands =====

use crate::token_usage::{RawUsage, TokenUsageState};
use std::path::PathBuf;

#[tauri::command(rename_all = "camelCase")]
pub fn get_session_token_usage(
    state: tauri::State<'_, TokenUsageState>,
    session_id: String,
    transcript_path: String,
    since_rfc3339: Option<String>,
) -> Result<RawUsage, String> {
    let path = PathBuf::from(&transcript_path);
    Ok(state.read_session_usage(&session_id, &path, since_rfc3339.as_deref()))
}

#[tauri::command(rename_all = "camelCase")]
pub fn reset_session_token_usage(
    state: tauri::State<'_, TokenUsageState>,
    session_id: String,
) -> Result<(), String> {
    state.reset_session(&session_id);
    Ok(())
}
