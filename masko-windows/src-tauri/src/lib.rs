mod commands;
mod hook_installer;
mod models;
mod server;
mod tray;

use std::collections::HashMap;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

/// Strip all window frame/border/shadow from the overlay HWND.
/// Called at init and on every focus event (WebView2 re-applies styles).
#[cfg(target_os = "windows")]
fn strip_overlay_frame(hwnd_raw: *mut std::ffi::c_void) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::*;
    use windows::Win32::UI::WindowsAndMessaging::*;
    let hwnd = HWND(hwnd_raw);
    unsafe {
        let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
        let clean = (style
            & !(WS_CAPTION.0
                | WS_THICKFRAME.0
                | WS_SYSMENU.0
                | WS_MINIMIZEBOX.0
                | WS_MAXIMIZEBOX.0
                | WS_OVERLAPPEDWINDOW.0))
            | WS_POPUP.0;
        SetWindowLongW(hwnd, GWL_STYLE, clean as i32);

        let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        let clean_ex = (ex
            & !WS_EX_DLGMODALFRAME.0
            & !WS_EX_APPWINDOW.0
            & !WS_EX_WINDOWEDGE.0)
            | WS_EX_NOACTIVATE.0
            | WS_EX_TOOLWINDOW.0;
        SetWindowLongW(hwnd, GWL_EXSTYLE, clean_ex as i32);

        let policy = DWMNCRP_DISABLED;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_NCRENDERING_POLICY,
            &policy as *const _ as *const _,
            std::mem::size_of_val(&policy) as u32,
        );

        SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_FRAMECHANGED | SWP_NOACTIVATE,
        )
        .ok();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Single shared PendingPermissions — used by both HTTP server and IPC commands
    let pending_permissions: server::PendingPermissions =
        Arc::new(Mutex::new(HashMap::new()));

    let pp_for_server = pending_permissions.clone();

    tauri::Builder::default()
        .manage(pending_permissions)
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .setup(move |app| {
            // Set up system tray
            tray::create_tray(app.handle())?;

            // Start the HTTP server — pass the SAME PendingPermissions instance
            let handle = app.handle().clone();
            let pp = pp_for_server.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::start(handle, pp).await {
                    eprintln!("[masko] Server error: {e}");
                }
            });

            // Auto-install hooks on startup
            match hook_installer::install(45832) {
                Ok(()) => println!("[masko] Hooks installed/updated"),
                Err(e) => eprintln!("[masko] Hook install failed: {e}"),
            }

            // Show overlay window — strip decorations and shadow on Windows
            if let Some(overlay) = app.get_webview_window("overlay") {
                #[cfg(target_os = "windows")]
                {
                    let hwnd_raw = overlay.hwnd().unwrap().0 as usize;
                    strip_overlay_frame(hwnd_raw as *mut std::ffi::c_void);

                    // WebView2 re-applies frame styles on focus/resize — re-strip on focus
                    let hwnd_clone = hwnd_raw;
                    overlay.on_window_event(move |event| {
                        if let tauri::WindowEvent::Focused(true) = event {
                            strip_overlay_frame(hwnd_clone as *mut std::ffi::c_void);
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Masko");
}
