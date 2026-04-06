# Masko Windows Project Scout Report

## Project Overview

Masko is a Tauri 2 desktop application built with Solid.js frontend and Rust backend. It's a mascot overlay system that runs on Windows (initially ported from browser to Windows native app).

Current Version: 0.1.0
App ID: ai.masko.desktop
Main Branch: main
Current Branch: feat/windows-tauri-port

---

## Tech Stack

### Frontend
- Framework: Solid.js 1.9 (reactive JS framework)
- Build Tool: Vite 6
- Styling: Tailwind CSS 4
- Language: TypeScript 5.7

### Backend (Rust)
- Framework: Tauri 2
- Async Runtime: Tokio
- Web Server: Axum 0.8
- Windows API: windows crate 0.58

### Key Dependencies

**Frontend (package.json)**
- @tauri-apps/api ^2
- @tauri-apps/plugin-global-shortcut ^2
- @tauri-apps/plugin-notification ^2
- @tauri-apps/plugin-updater ^2 (INSTALLED but NOT INTEGRATED)
- solid-js ^1.9

**Backend (Cargo.toml)**
- tauri ^2 (features: tray-icon, devtools)
- tauri-plugin-global-shortcut ^2
- tauri-plugin-notification ^2
- serde, serde_json
- tokio (full features)
- axum ^0.8
- uuid, chrono
- reqwest ^0.12
- notify ^7
- windows ^0.58 (Win32 bindings for overlay)

---

## Project Structure

d:\project\other\masko-code/
├── src/                           (Frontend - Solid.js TypeScript)
│   ├── App.tsx                   (Main dashboard)
│   ├── index.tsx                 (Main window entry)
│   ├── overlay-entry.tsx         (Overlay window entry)
│   ├── components/
│   │   ├── dashboard/
│   │   │   ├── ActivityFeed.tsx
│   │   │   ├── MascotGallery.tsx
│   │   │   ├── NotificationCenter.tsx
│   │   │   ├── SessionList.tsx
│   │   │   └── SettingsPanel.tsx
│   │   ├── overlay/
│   │   │   ├── MascotOverlay.tsx
│   │   │   ├── PermissionPrompt.tsx
│   │   │   ├── WorkingBubble.tsx
│   │   │   └── BubbleTail.tsx
│   │   └── shared/
│   ├── services/
│   │   ├── ipc.ts
│   │   ├── event-processor.ts
│   │   ├── state-machine.ts
│   │   └── log.ts
│   ├── stores/                   (Solid.js reactive state)
│   │   ├── app-store.ts
│   │   ├── event-store.ts
│   │   ├── mascot-store.ts
│   │   ├── notification-store.ts
│   │   ├── overlay-position-store.ts
│   │   ├── permission-store.ts
│   │   ├── session-store.ts
│   │   └── working-bubble-store.ts
│   ├── models/
│   ├── styles/
│   └── assets/
├── src-tauri/                     (Rust backend)
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs                (App setup, plugins)
│   │   ├── commands.rs           (IPC handlers)
│   │   ├── hook_installer.rs     (DLL hook system)
│   │   ├── server.rs             (Axum HTTP server)
│   │   ├── tray.rs               (Tray icon)
│   │   ├── win_overlay.rs        (Win32 overlay logic)
│   │   ├── models.rs
│   │   └── log.rs
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/
├── dist/                         (Built frontend)
├── public/
├── index.html                    (Main window HTML)
├── overlay.html                  (Overlay HTML)
├── package.json
├── tsconfig.json
├── vite.config.ts
└── docs/

---

## Tauri Configuration (tauri.conf.json)

- Product Name: Masko
- App ID: ai.masko.desktop
- Version: 0.1.0
- Windows:
  - main: Dashboard (1000x700, resizable)
  - overlay: Transparent overlay (1920x1080, alwaysOnTop, skipTaskbar)
- Build:
  - beforeDevCommand: npm run dev (Vite on port 1421)
  - frontendDist: ../dist
- Bundle:
  - Active, targets NSIS (Windows installer)
  - Icons: 32x32, 128x128, 128x128@2x, .ico
  - Installation mode: currentUser
  - Digest: sha256

---

## IPC Commands Exposed (src-tauri/src/commands.rs)

- get_server_status()
- resolve_permission(request_id, decision)
- install_hooks()
- uninstall_hooks()
- is_hooks_registered()
- set_overlay_permission_visible(bool)
- set_overlay_working_bubble_visible(bool)
- set_overlay_dragging(bool)
- update_mascot_position(x, y, w, h)
- get_monitor_at_point(x, y)
- update_working_bubble_zone(x, y, w, h)
- update_permission_zone(x, y, w, h)
- quit_app()
- open_devtools()
- get_virtual_desktop_bounds()
- move_overlay_to_monitor(x, y)

---

## Update Infrastructure Status

### Current State
- Plugin installed: @tauri-apps/plugin-updater ^2 (package.json)
- Plugin NOT initialized: No tauri_plugin_updater in lib.rs
- No updater config: tauri.conf.json has no updater section
- No UI: No update UI in SettingsPanel or components
- No commands: No custom update handlers exposed

### What's Missing for Full Integration
1. Plugin initialization in lib.rs
2. Updater config in tauri.conf.json
3. Frontend update UI component
4. Update event listeners
5. Backend command handlers for check/download/install

---

## Main Entry Points

### Frontend
- Dashboard: src/index.tsx -> src/App.tsx (Solid.js app)
- Overlay: src/overlay-entry.tsx -> overlay components

### Backend
- Entry: src-tauri/src/main.rs -> lib.rs:run() (Tauri app)
- Plugins loaded: global-shortcut, notification
- Hook system: Custom DLL at port 45832

---

## Build Flow

npm run dev               - Frontend dev (Vite on 1421)
npm run build            - Frontend build (TypeScript + Vite)
npm run tauri dev        - Full dev (frontend + Tauri runtime)
npm run tauri build      - Full build (frontend + Cargo + NSIS)

Vite: Multi-entry (index.html + overlay.html), path alias @ -> ./src

---

## Architecture Notes

1. Windows Overlay: Win32 DWM API for transparent, always-on-top window
2. Hook System: Custom DLL injection at port 45832
3. Multi-monitor: Supports virtual desktop bounds tracking
4. Cursor Polling: 16ms loop to detect interactive zones
5. Solid.js State: Reactive stores for UI state
6. Two-window Design: Dashboard + Overlay separation

---

## Recent Commits

1. 77cb59f - refactor: rename closeMenu to quitApp
2. e2dbad7 - refactor: overlay positioning for virtual desktop
3. acf3154 - chore: dependencies and hook handling
4. 839bf7f - fix: permission handling logic
5. 5b111a1 - fix: SettingsPanel and PermissionPrompt styling

---

## Integration Checklist for Updates

To integrate updater plugin:

1. Initialize plugin in src-tauri/src/lib.rs (.plugin(tauri_plugin_updater::Builder...))
2. Add updater section to tauri.conf.json (endpoints, windows installer settings)
3. Create update commands (check, download, install)
4. Add update UI to SettingsPanel component
5. Listen for update-available and update-ready events
6. Handle installer signature verification (for releases)

The plugin dependency is already in place - just needs wiring.

