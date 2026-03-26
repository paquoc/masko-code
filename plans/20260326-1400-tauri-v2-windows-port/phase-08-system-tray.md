# Phase 08: System Tray

## Context
- Parent: [plan.md](plan.md)
- Dependencies: Phase 01
- Reference: `Sources/Views/MenuBar/MenuBarView.swift`

## Overview
- **Date:** 2026-03-26
- **Priority:** Medium
- **Status:** Pending
- **Review:** Not started
- **Description:** System tray icon with context menu for quick access to show/hide overlay, open dashboard, settings, and quit.

## Key Insights
- macOS uses MenuBarExtra with .window style (custom SwiftUI content)
- Tauri v2 tray supports native menus (simpler, platform-native look)
- Tray icon shows unread notification badge (red dot overlay)
- Left-click shows menu, tray is the primary entry point

## Requirements
- System tray icon with Masko logo
- Context menu: Show/Hide Mascot, Open Dashboard, Settings, Check Updates, Quit
- Notification badge indicator
- Double-click opens dashboard

## Related Code Files

### Create:
- `src-tauri/src/tray.rs` — Tray icon setup and menu handlers

### Modify:
- `src-tauri/src/main.rs` — Register tray on startup

### Reference:
- `Sources/Views/MenuBar/MenuBarView.swift`

## Implementation Steps

1. Create tray in Rust:
   ```rust
   let menu = Menu::with_items(app, &[
       &MenuItem::with_id(app, "show_mascot", "Show Mascot", true, None)?,
       &MenuItem::with_id(app, "dashboard", "Open Dashboard", true, None)?,
       &PredefinedMenuItem::separator(app)?,
       &MenuItem::with_id(app, "settings", "Settings", true, None)?,
       &MenuItem::with_id(app, "check_updates", "Check for Updates", true, None)?,
       &PredefinedMenuItem::separator(app)?,
       &MenuItem::with_id(app, "quit", "Quit Masko", true, None)?,
   ])?;

   TrayIconBuilder::new()
       .icon(app.default_window_icon().unwrap().clone())
       .tooltip("Masko Code")
       .menu(&menu)
       .on_menu_event(handle_tray_event)
       .build(app)?;
   ```

2. Handle menu events — show/hide windows, quit app

3. Tray icon variants:
   - Normal: Masko logo (16x16 and 32x32 for DPI scaling)
   - With badge: Logo + red dot (composite image)

4. Double-click handler: open dashboard window

## Todo
- [ ] Create tray icon with Masko logo
- [ ] Build context menu with all items
- [ ] Handle menu events (show/hide, dashboard, quit)
- [ ] Implement notification badge on tray icon
- [ ] Test tray behavior on Windows 11

## Success Criteria
- Tray icon visible in Windows system tray
- Menu items work correctly
- Dashboard opens on double-click

## Risk Assessment
- Low risk — Tauri tray API is well-supported on Windows

## Security Considerations
- None specific to tray

## Next Steps
→ Phase 09: Global Hotkeys
