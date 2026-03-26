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

            // Show overlay window on startup — remove shadow on Windows
            if let Some(overlay) = app.get_webview_window("overlay") {
                #[cfg(target_os = "windows")]
                {
                    use windows::Win32::UI::WindowsAndMessaging::*;
                    use windows::Win32::Graphics::Dwm::*;
                    use windows::Win32::Foundation::HWND;
                    let hwnd = HWND(overlay.hwnd().unwrap().0);
                    unsafe {
                        // Disable DWM shadow via DWMWA_NCRENDERING_POLICY
                        let policy = DWMNCRP_DISABLED;
                        let _ = DwmSetWindowAttribute(
                            hwnd,
                            DWMWA_NCRENDERING_POLICY,
                            &policy as *const _ as *const _,
                            std::mem::size_of_val(&policy) as u32,
                        );

                        // Also set WS_EX_NOACTIVATE so overlay doesn't steal focus
                        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                        SetWindowLongW(
                            hwnd,
                            GWL_EXSTYLE,
                            ex_style | WS_EX_NOACTIVATE.0 as i32,
                        );

                        // Apply changes
                        SetWindowPos(
                            hwnd,
                            HWND_TOPMOST,
                            0, 0, 0, 0,
                            SWP_NOMOVE | SWP_NOSIZE | SWP_FRAMECHANGED,
                        ).ok();
                    }
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Masko");
}
