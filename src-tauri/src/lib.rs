#[macro_use]
mod log;
mod commands;
mod hook_installer;
mod models;
mod server;
mod tray;
mod telegram;
mod token_usage;

#[cfg(target_os = "windows")]
mod autostart;

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
        .manage(crate::token_usage::TokenUsageState::new())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            tray::create_tray(app.handle())?;

            // Initialize Telegram manager synchronously so the State is ready
            // before commands are invoked.
            let manager = tauri::async_runtime::block_on(
                telegram::TelegramManager::init(app.handle().clone())
            );
            app.manage(manager);

            let handle = app.handle().clone();
            let pp = pp_for_server.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::start(handle, pp).await {
                    mlog_err!("Server error: {e}");
                }
            });

            match hook_installer::install(45832) {
                Ok(()) => mlog!("Hooks installed/updated"),
                Err(e) => mlog_err!("Hook install failed: {e}"),
            }


            if let Some(overlay) = app.get_webview_window("overlay") {
                #[cfg(target_os = "windows")]
                {
                    let hwnd_raw = overlay.hwnd().unwrap().0 as usize;
                    let hwnd_ptr = hwnd_raw as *mut std::ffi::c_void;

                    unsafe {
                        crate::win_overlay::strip_frame(hwnd_ptr);
                        crate::win_overlay::subclass_overlay(hwnd_ptr);

                        // Resize overlay to cover entire virtual desktop (all monitors)
                        let (mx, my, mw, mh) = crate::win_overlay::get_virtual_desktop_bounds();
                        crate::win_overlay::resize_to_monitor(hwnd_ptr, mx, my, mw, mh);
                        mlog!("Overlay resized to virtual desktop: {}x{} at ({},{})", mw, mh, mx, my);
                    }

                    // Poll cursor ~60fps, emit zone changes so frontend can toggle
                    // setIgnoreCursorEvents (required for WebView2 DirectComposition).
                    // WM_STYLECHANGING in the wndproc prevents frame flash by stripping
                    // frame bits before SWP_FRAMECHANGED can render them.
                    let emit_handle = app.handle().clone();
                    std::thread::spawn(move || {
                        let mut was_ignore = false;
                        let mut tick_count: u64 = 0;
                        let mut dpr_logged = false;
                        emit_handle.emit("overlay-cursor-zone", true).ok();
                        loop {
                            std::thread::sleep(std::time::Duration::from_millis(16));
                            tick_count += 1;

                            // One-time DPI mismatch check once frontend reports DPR
                            if !dpr_logged {
                                let fdpr = crate::win_overlay::FRONTEND_DPR_X1000
                                    .load(std::sync::atomic::Ordering::Relaxed);
                                if fdpr > 0 {
                                    dpr_logged = true;
                                    let hwnd = windows::Win32::Foundation::HWND(
                                        hwnd_raw as *mut std::ffi::c_void,
                                    );
                                    let wdpi = unsafe {
                                        windows::Win32::UI::HiDpi::GetDpiForWindow(hwnd)
                                    };
                                    let wscale_x1000 = if wdpi > 0 {
                                        (wdpi as u64 * 1000 / 96) as u32
                                    } else {
                                        1000
                                    };
                                    if fdpr != wscale_x1000 {
                                        mlog!(
                                            "DPI MISMATCH: frontend dpr={:.3} vs GetDpiForWindow={} (scale={:.3})",
                                            fdpr as f64 / 1000.0,
                                            wdpi,
                                            wscale_x1000 as f64 / 1000.0,
                                        );
                                    } else {
                                        mlog!(
                                            "DPI match: frontend dpr={:.3}, windowDpi={}",
                                            fdpr as f64 / 1000.0,
                                            wdpi,
                                        );
                                    }
                                }
                            }

                            // Re-assert TOPMOST every ~30s (1875 ticks * 16ms)
                            // Windows can steal TOPMOST when other apps claim it
                            if tick_count % 1875 == 0 {
                                let hwnd = windows::Win32::Foundation::HWND(
                                    hwnd_raw as *mut std::ffi::c_void,
                                );
                                unsafe {
                                    windows::Win32::UI::WindowsAndMessaging::SetWindowPos(
                                        hwnd,
                                        windows::Win32::UI::WindowsAndMessaging::HWND_TOPMOST,
                                        0, 0, 0, 0,
                                        windows::Win32::UI::WindowsAndMessaging::SWP_NOMOVE
                                            | windows::Win32::UI::WindowsAndMessaging::SWP_NOSIZE
                                            | windows::Win32::UI::WindowsAndMessaging::SWP_NOACTIVATE,
                                    ).ok();
                                }
                                // Re-assert not-fullscreen so the taskbar stays
                                // above regular app windows.
                                crate::win_overlay::mark_not_fullscreen(
                                    hwnd_raw as *mut std::ffi::c_void,
                                );
                            }

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

            mlog!("Masko desktop started");
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    window.hide().ok();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_server_status,
            commands::resolve_permission,
            commands::install_hooks,
            commands::uninstall_hooks,
            commands::is_hooks_registered,
            commands::set_overlay_permission_visible,
            commands::set_overlay_working_bubble_visible,
            commands::set_overlay_dragging,
            commands::update_frontend_dpr,
            commands::update_mascot_position,
            commands::get_monitor_at_point,
            commands::get_virtual_desktop_bounds,
            commands::move_overlay_to_monitor,
            commands::quit_app,
            commands::open_devtools,
            commands::debug_overlay_info,
            commands::update_working_bubble_zone,
            commands::update_permission_zone,
            commands::set_overlay_token_panel_visible,
            commands::update_token_panel_zone,
            commands::focus_overlay,
            commands::unfocus_overlay,
            commands::get_autostart,
            commands::set_autostart,
            commands::telegram_get_config,
            commands::telegram_save_config,
            commands::telegram_test,
            commands::telegram_set_polling_enabled,
            commands::telegram_set_sending_enabled,
            commands::telegram_get_status,
            commands::get_session_token_usage,
            commands::reset_session_token_usage,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Masko");
}
