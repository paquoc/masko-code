mod commands;
mod hook_installer;
mod models;
mod server;
mod tray;
mod usage;

use std::collections::HashMap;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

#[cfg(target_os = "windows")]
mod win_overlay {
    use std::sync::atomic::{AtomicIsize, Ordering};
    use windows::Win32::Foundation::*;
    use windows::Win32::Graphics::Dwm::*;
    use windows::Win32::UI::WindowsAndMessaging::*;

    static ORIGINAL_WNDPROC: AtomicIsize = AtomicIsize::new(0);

    const WM_NCACTIVATE: u32 = 0x0086;
    const WM_NCPAINT: u32 = 0x0085;

    unsafe extern "system" fn overlay_wndproc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        let original: WNDPROC = std::mem::transmute(ORIGINAL_WNDPROC.load(Ordering::Relaxed));

        match msg {
            // Prevent Windows/WebView2 from painting the ghost titlebar on focus change
            WM_NCACTIVATE => {
                // Pass wparam (active state) but set lparam=-1 to suppress NC redraw
                return CallWindowProcW(original, hwnd, msg, wparam, LPARAM(-1));
            }
            // Suppress non-client paint entirely
            WM_NCPAINT => {
                return LRESULT(0);
            }
            _ => {}
        }

        CallWindowProcW(original, hwnd, msg, wparam, lparam)
    }

    /// Subclass the overlay window to intercept NC messages that cause ghost titlebar.
    pub unsafe fn subclass_overlay(hwnd_raw: *mut std::ffi::c_void) {
        let hwnd = HWND(hwnd_raw);
        let original = SetWindowLongPtrW(hwnd, GWLP_WNDPROC, overlay_wndproc as isize);
        ORIGINAL_WNDPROC.store(original, Ordering::Relaxed);
    }

    /// Strip all window frame/border/shadow from the overlay HWND.
    pub unsafe fn strip_frame(hwnd_raw: *mut std::ffi::c_void) {
        let hwnd = HWND(hwnd_raw);

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
                        win_overlay::strip_frame(hwnd_ptr);
                        win_overlay::subclass_overlay(hwnd_ptr);
                    }

                    let hwnd_clone = hwnd_raw;
                    overlay.on_window_event(move |event| {
                        if matches!(event, tauri::WindowEvent::Focused(_)) {
                            unsafe {
                                win_overlay::strip_frame(hwnd_clone as *mut std::ffi::c_void);
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
            commands::fetch_usage,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Masko");
}
