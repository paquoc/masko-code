mod commands;
mod hook_installer;
mod models;
mod server;
mod tray;
// mod usage; // temporarily disabled

use std::collections::HashMap;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tokio::sync::Mutex;

#[cfg(target_os = "windows")]
mod win_overlay;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pending_permissions: server::PendingPermissions =
        Arc::new(Mutex::new(HashMap::new()));

    let pp_for_server = pending_permissions.clone();

    tauri::Builder::default()
        .manage(pending_permissions)
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .setup(move |app| {
            tray::create_tray(app.handle())?;

            let handle = app.handle().clone();
            let pp = pp_for_server.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::start(handle, pp).await {
                    eprintln!("[masko] Server error: {e}");
                }
            });

            match hook_installer::install(45832) {
                Ok(()) => println!("[masko] Hooks installed/updated"),
                Err(e) => eprintln!("[masko] Hook install failed: {e}"),
            }

            if let Some(overlay) = app.get_webview_window("overlay") {
                #[cfg(target_os = "windows")]
                {
                    let hwnd_raw = overlay.hwnd().unwrap().0 as usize;
                    let hwnd_ptr = hwnd_raw as *mut std::ffi::c_void;

                    unsafe {
                        crate::win_overlay::strip_frame(hwnd_ptr);
                        crate::win_overlay::subclass_overlay(hwnd_ptr);
                    }

                    // Poll cursor ~60fps, emit zone changes so frontend can toggle
                    // setIgnoreCursorEvents (required for WebView2 DirectComposition).
                    // WM_STYLECHANGING in the wndproc prevents frame flash by stripping
                    // frame bits before SWP_FRAMECHANGED can render them.
                    let emit_handle = app.handle().clone();
                    std::thread::spawn(move || {
                        let mut was_ignore = false;
                        emit_handle.emit("overlay-cursor-zone", true).ok();
                        loop {
                            std::thread::sleep(std::time::Duration::from_millis(16));
                            let interactive =
                                crate::win_overlay::is_cursor_in_interactive_area(hwnd_raw);
                            let should_ignore = !interactive;
                            if should_ignore != was_ignore {
                                was_ignore = should_ignore;
                                emit_handle.emit("overlay-cursor-zone", should_ignore).ok();
                            }
                        }
                    });
                }
                overlay.show().ok();
            }

            println!("[masko] Masko desktop started");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_server_status,
            commands::resolve_permission,
            commands::install_hooks,
            commands::uninstall_hooks,
            commands::is_hooks_registered,
            commands::set_overlay_permission_visible,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Masko");
}
