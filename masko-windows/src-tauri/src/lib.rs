mod commands;
mod hook_installer;
mod models;
mod server;
mod tray;

use std::collections::HashMap;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pending_permissions: server::PendingPermissions =
        Arc::new(Mutex::new(HashMap::new()));

    tauri::Builder::default()
        .manage(pending_permissions)
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Set up system tray
            tray::create_tray(app.handle())?;

            // Start the HTTP server for hook events
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::start(handle).await {
                    eprintln!("[masko] Server error: {e}");
                }
            });

            // Auto-install hooks on startup (also cleans up legacy entries)
            match hook_installer::install(45832) {
                Ok(()) => println!("[masko] Hooks installed/updated"),
                Err(e) => eprintln!("[masko] Hook install failed: {e}"),
            }

            // Show overlay window on startup (if enabled)
            if let Some(overlay) = app.get_webview_window("overlay") {
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Masko");
}
