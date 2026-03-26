use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

pub fn create_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show_mascot", "Show Mascot", true, None::<&str>)?;
    let dashboard = MenuItem::with_id(app, "dashboard", "Open Dashboard", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Masko", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &dashboard, &sep1, &settings, &sep2, &quit])?;

    TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Masko Code")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show_mascot" => {
                if let Some(overlay) = app.get_webview_window("overlay") {
                    overlay.show().ok();
                }
            }
            "dashboard" => {
                if let Some(main) = app.get_webview_window("main") {
                    main.show().ok();
                    main.set_focus().ok();
                }
            }
            "settings" => {
                if let Some(main) = app.get_webview_window("main") {
                    main.show().ok();
                    main.set_focus().ok();
                    // TODO: emit event to navigate to settings tab
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}
